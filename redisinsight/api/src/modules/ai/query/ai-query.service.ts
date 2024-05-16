import { Socket } from 'socket.io-client';
import { Injectable, Logger } from '@nestjs/common';
import { ClientContext, SessionMetadata } from 'src/common/models';
import { AiQueryProvider } from 'src/modules/ai/query/providers/ai-query.provider';
import { SendAiQueryMessageDto } from 'src/modules/ai/query/dto/send.ai-query.message.dto';
import { wrapAiQueryError } from 'src/modules/ai/query/exceptions';
import { DatabaseClientFactory } from 'src/modules/database/providers/database.client.factory';
import { getFullDbContext, getIndexContext } from 'src/modules/ai/query/utils/context.util';
import { Response } from 'express';
import {
  AiQueryMessage,
  AiQueryMessageType,
  AiQueryMessageRole,
  AiQueryWsEvents,
  AiQueryIntermediateStepType,
  AiQueryIntermediateStep,
} from 'src/modules/ai/query/models';
import { AiQueryMessageRepository } from 'src/modules/ai/query/repositories/ai-query.message.repository';
import { AiQueryAuthProvider } from 'src/modules/ai/query/providers/auth/ai-query-auth.provider';
import { classToClass } from 'src/utils';
import { plainToClass } from 'class-transformer';
import { AiQueryContextRepository } from 'src/modules/ai/query/repositories/ai-query.context.repository';

const COMMANDS_WHITELIST = {
  'ft.search': true,
  'ft.aggregate': true,
};

@Injectable()
export class AiQueryService {
  private readonly logger = new Logger('AiQueryService');

  constructor(
    private readonly aiQueryProvider: AiQueryProvider,
    private readonly databaseClientFactory: DatabaseClientFactory,
    private readonly aiQueryMessageRepository: AiQueryMessageRepository,
    private readonly aiQueryAuthProvider: AiQueryAuthProvider,
    private readonly aiQueryContextRepository: AiQueryContextRepository,
  ) {}

  static prepareHistoryIntermediateSteps(message: AiQueryMessage): [AiQueryMessageRole, string][] {
    const steps = [];
    message.steps.forEach((step) => {
      switch (step.type) {
        case AiQueryIntermediateStepType.TOOL:
          steps.push([AiQueryMessageRole.TOOL, step.data]);
          break;
        case AiQueryIntermediateStepType.TOOL_CALL:
          steps.push([AiQueryMessageRole.TOOL_CALL, step.data]);
          break;
        default:
          // ignore
      }
    });

    return steps;
  }

  static prepareHistory(messages: AiQueryMessage[]): string[][] {
    const history = [];
    messages.forEach((message) => {
      switch (message.type) {
        case AiQueryMessageType.AiMessage:
          history.push([AiQueryMessageRole.AI, message.content]);
          if (message.steps.length) {
            history.push(...AiQueryService.prepareHistoryIntermediateSteps(message));
          }
          break;
        case AiQueryMessageType.HumanMessage:
          history.push([AiQueryMessageRole.HUMAN, message.content]);
          break;
        default:
          // ignore
      }
    });

    return history;
  }

  async stream(
    sessionMetadata: SessionMetadata,
    databaseId: string,
    dto: SendAiQueryMessageDto,
    res: Response,
  ) {
    let socket: Socket;

    try {
      const auth = await this.aiQueryAuthProvider.getAuthData(sessionMetadata);
      const history = await this.aiQueryMessageRepository.list(sessionMetadata, databaseId, auth.accountId);

      const client = await this.databaseClientFactory.getOrCreateClient({
        sessionMetadata,
        databaseId,
        context: ClientContext.AI,
      });

      let context = await this.aiQueryContextRepository.getFullDbContext(sessionMetadata, databaseId, auth.accountId);

      if (!context) {
        context = await this.aiQueryContextRepository.setFullDbContext(
          sessionMetadata,
          databaseId,
          auth.accountId,
          await getFullDbContext(client),
        );
      }

      const question = classToClass(AiQueryMessage, {
        type: AiQueryMessageType.HumanMessage,
        content: dto.content,
        databaseId,
        accountId: auth.accountId,
        createdAt: new Date(),
      });

      const answer = classToClass(AiQueryMessage, {
        type: AiQueryMessageType.AiMessage,
        content: '',
        databaseId,
        accountId: auth.accountId,
      });

      socket = await this.aiQueryProvider.getSocket(sessionMetadata, auth);

      socket.on(AiQueryWsEvents.REPLY_CHUNK, (chunk) => {
        answer.content += chunk;
        res.write(chunk);
      });

      socket.on(AiQueryWsEvents.GET_INDEX, async (index, cb) => {
        try {
          const indexContext = await this.aiQueryContextRepository.getIndexContext(
            sessionMetadata,
            databaseId,
            auth.accountId,
            index,
          );

          if (!context) {
            return cb(await this.aiQueryContextRepository.setIndexContext(
              sessionMetadata,
              databaseId,
              auth.accountId,
              index,
              await getIndexContext(client, index),
            ));
          }

          return cb(indexContext);
        } catch (e) {
          this.logger.warn('Unable to create index content', e);
          return cb(e.message);
        }
      });

      socket.on(AiQueryWsEvents.RUN_QUERY, async (data, cb) => {
        try {
          if (!COMMANDS_WHITELIST[(data?.[0] || '').toLowerCase()]) {
            return cb('-ERR: This command is not allowed');
          }

          return cb(await client.sendCommand(data, { replyEncoding: 'utf8' }));
        } catch (e) {
          this.logger.warn('Query execution error', e);
          return cb(e.message);
        }
      });

      socket.on(AiQueryWsEvents.TOOL_CALL, async (data) => {
        answer.steps.push(plainToClass(AiQueryIntermediateStep, {
          type: AiQueryIntermediateStepType.TOOL_CALL,
          data,
        }));
      });

      socket.on(AiQueryWsEvents.TOOL_REPLY, async (data) => {
        answer.steps.push(plainToClass(AiQueryIntermediateStep, {
          type: AiQueryIntermediateStepType.TOOL,
          data,
        }));
      });

      await socket.emitWithAck('stream', dto.content, context, AiQueryService.prepareHistory(history));
      socket.close();
      await this.aiQueryMessageRepository.createMany(sessionMetadata, [question, answer]);

      return res.end();
    } catch (e) {
      socket?.close?.();
      throw wrapAiQueryError(e, 'Unable to send the question');
    }
  }

  async getHistory(sessionMetadata: SessionMetadata, databaseId: string): Promise<AiQueryMessage[]> {
    try {
      const auth = await this.aiQueryAuthProvider.getAuthData(sessionMetadata);
      return await this.aiQueryMessageRepository.list(sessionMetadata, databaseId, auth.accountId);
    } catch (e) {
      throw wrapAiQueryError(e, 'Unable to get history');
    }
  }

  async clearHistory(sessionMetadata: SessionMetadata, databaseId: string): Promise<void> {
    try {
      const auth = await this.aiQueryAuthProvider.getAuthData(sessionMetadata);

      await this.aiQueryContextRepository.reset(sessionMetadata, databaseId, auth.accountId);

      return this.aiQueryMessageRepository.clearHistory(sessionMetadata, databaseId, auth.accountId);
    } catch (e) {
      throw wrapAiQueryError(e, 'Unable to clear history');
    }
  }
}
