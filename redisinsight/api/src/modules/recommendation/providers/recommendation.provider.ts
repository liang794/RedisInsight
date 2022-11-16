import { Injectable } from '@nestjs/common';
import { Redis, Command } from 'ioredis';
import { get } from 'lodash';
import { convertRedisInfoReplyToObject } from 'src/utils';
import { RedisDataType } from 'src/modules/browser/dto';
import { Recommendation } from 'src/modules/database-analysis/models/recommendation';
import { Key } from 'src/modules/database-analysis/models';

const minNumberOfCachedScripts = 10;
const maxHashLength = 5000;
const maxDatabaseTotal = 1_000_000;

@Injectable()
export class RecommendationProvider {
  /**
   * Check lua script recommendation
   * @param redisClient
   */
  async determineLuaScriptRecommendation(
    redisClient: Redis,
  ): Promise<Recommendation> {
    const info = convertRedisInfoReplyToObject(
      await redisClient.sendCommand(
        new Command('info', [], { replyEncoding: 'utf8' }),
      ) as string,
    );
    const nodesNumbersOfCachedScripts = get(info, 'memory.number_of_cached_scripts');

    return ({
      name: 'luaScript',
      isActual: parseInt(nodesNumbersOfCachedScripts, 10) > minNumberOfCachedScripts,
    });
  }

  /**
   * Check big hashes recommendation
   * @param keys
   */
  async determineBigHashesRecommendation(
    keys: Key[],
  ): Promise<Recommendation> {
    const bigHashes = keys.filter((key) => key.type === RedisDataType.Hash && key.length > maxHashLength);
    return ({
      name: 'bigHashes',
      isActual: bigHashes.length > 0,
    });
  }

  /**
   * Check big hashes recommendation
   * @param total
   */
  async determineBigTotalRecommendation(
    total: number,
  ): Promise<Recommendation> {
    return ({
      name: 'useSmallerKeys',
      isActual: total > maxDatabaseTotal,
    });
  }
}
