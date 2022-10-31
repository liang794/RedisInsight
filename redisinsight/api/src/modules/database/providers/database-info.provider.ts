import { BadRequestException, Injectable } from '@nestjs/common';
import * as IORedis from 'ioredis';
import {
  IRedisClusterInfo,
  IRedisClusterNodeAddress,
  RedisClusterNodeLinkState,
} from 'src/models';
import {
  catchAclError,
  convertBulkStringsToObject,
  convertIntToSemanticVersion,
  convertStringsArrayToObject,
  parseClusterNodes,
} from 'src/utils';
import { AdditionalRedisModule } from 'src/modules/database/models/additional.redis.module';
import { REDIS_MODULES_COMMANDS, SUPPORTED_REDIS_MODULES } from 'src/constants';
import { isNil } from 'lodash';
import { SentinelMaster, SentinelMasterStatus } from 'src/modules/redis-sentinel/models/sentinel-master';
import ERROR_MESSAGES from 'src/constants/error-messages';
import { Endpoint } from 'src/common/models';

@Injectable()
export class DatabaseInfoProvider {
  /**
   * Check weather current database is a cluster
   * @param client
   */
  public async isCluster(client: IORedis.Redis): Promise<boolean> {
    try {
      const reply = await client.cluster('INFO');
      const clusterInfo: IRedisClusterInfo = convertBulkStringsToObject(reply);
      return clusterInfo?.cluster_state === 'ok';
    } catch (e) {
      return false;
    }
  }

  /**
   * Check weather current database is a sentinel
   * @param client
   */
  public async isSentinel(client: IORedis.Redis): Promise<boolean> {
    try {
      await client.call('sentinel', ['masters']);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Determine all cluster nodes for current connection (client)
   * @param client
   */
  public async determineClusterNodes(
    client: IORedis.Redis,
  ): Promise<IRedisClusterNodeAddress[]> {
    const nodes = parseClusterNodes(await client.call('cluster', ['nodes']) as string)
      .filter((node) => node.linkState === RedisClusterNodeLinkState.Connected);

    return nodes.map((node) => ({
      host: node.host,
      port: node.port,
    }));
  }

  /**
   * Determine database modules using "module list" command
   * In case when "module" command is not available use "command info" approach
   * @param client
   */
  public async determineDatabaseModules(client: any): Promise<AdditionalRedisModule[]> {
    try {
      const reply = await client.call('module', ['list']);
      const modules = reply.map((module: any[]) => convertStringsArrayToObject(module));
      return modules.map(({ name, ver }) => ({
        name: SUPPORTED_REDIS_MODULES[name] ?? name,
        version: ver,
        semanticVersion: SUPPORTED_REDIS_MODULES[name]
          ? convertIntToSemanticVersion(ver)
          : undefined,
      }));
    } catch (e) {
      return this.determineDatabaseModulesUsingInfo(client);
    }
  }

  /**
   * Determine database modules by using "command info" command for each listed (known/supported) module
   * @param client
   * @private
   */
  public async determineDatabaseModulesUsingInfo(client: any): Promise<AdditionalRedisModule[]> {
    const modules: AdditionalRedisModule[] = [];
    await Promise.all(Array.from(REDIS_MODULES_COMMANDS, async ([moduleName, commands]) => {
      try {
        let commandsInfo = await client.call('command', ['info', ...commands]);
        commandsInfo = commandsInfo.filter((info) => !isNil(info));
        if (commandsInfo.length) {
          modules.push({ name: moduleName });
        }
      } catch (e) {
        // continue regardless of error
      }
    }));
    return modules;
  }

  /**
   * Get list of master groups for Sentinel instance using established connection (client)
   * @param client
   */
  public async determineSentinelMasterGroups(client: IORedis.Redis): Promise<SentinelMaster[]> {
    let result: SentinelMaster[];
    try {
      const reply = await client.call('sentinel', ['masters']);
      // @ts-expect-error
      // https://github.com/luin/ioredis/issues/1572
      result = reply.map((item) => {
        const {
          ip,
          port,
          name,
          'num-slaves': numberOfSlaves,
          flags,
        } = convertStringsArrayToObject(item);
        return {
          host: ip,
          port: parseInt(port, 10),
          name,
          status: flags?.includes('down') ? SentinelMasterStatus.Down : SentinelMasterStatus.Active,
          numberOfSlaves: parseInt(numberOfSlaves, 10),
        };
      });
      await Promise.all(
        result.map(async (master: SentinelMaster, index: number) => {
          const nodes = await this.getMasterEndpoints(client, master.name);
          result[index] = {
            ...master,
            nodes,
          };
        }),
      );

      return result;
    } catch (error) {
      if (error.message.includes('unknown command `sentinel`')) {
        throw new BadRequestException(ERROR_MESSAGES.WRONG_DISCOVERY_TOOL());
      }

      throw catchAclError(error);
    }
  }

  /**
   * Get list of Sentinels for particular Sentinel master group
   * @param client
   * @param masterName
   */
  private async getMasterEndpoints(
    client: IORedis.Redis,
    masterName: string,
  ): Promise<Endpoint[]> {
    let result: Endpoint[];
    try {
      const reply = await client.call('sentinel', [
        'sentinels',
        masterName,
      ]);
      // @ts-expect-error
      // https://github.com/luin/ioredis/issues/1572
      result = reply.map((item) => {
        const { ip, port } = convertStringsArrayToObject(item);
        return { host: ip, port: parseInt(port, 10) };
      });

      return [
        { host: client.options.host, port: client.options.port },
        ...result,
      ];
    } catch (error) {
      if (error.message.includes('unknown command `sentinel`')) {
        throw new BadRequestException(ERROR_MESSAGES.WRONG_DATABASE_TYPE);
      }

      throw catchAclError(error);
    }
  }
}
