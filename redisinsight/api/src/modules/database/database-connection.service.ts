import { Injectable, Logger } from '@nestjs/common';
import { RECOMMENDATION_NAMES } from 'src/constants';
import { DatabaseRepository } from 'src/modules/database/repositories/database.repository';
import { DatabaseAnalytics } from 'src/modules/database/database.analytics';
import { DatabaseInfoProvider } from 'src/modules/database/providers/database-info.provider';
import { DatabaseRecommendationService } from 'src/modules/database-recommendation/database-recommendation.service';
import { Database } from 'src/modules/database/models/database';
import { ClientMetadata } from 'src/common/models';
import { DatabaseClientFactory } from 'src/modules/database/providers/database.client.factory';
import { RedisClient, RedisClientConnectionType, RedisClientNodeRole } from 'src/modules/redis/client';

@Injectable()
export class DatabaseConnectionService {
  private logger = new Logger('DatabaseConnectionService');

  constructor(
    private readonly databaseClientFactory: DatabaseClientFactory,
    private readonly databaseInfoProvider: DatabaseInfoProvider,
    private readonly repository: DatabaseRepository,
    private readonly analytics: DatabaseAnalytics,
    private recommendationService: DatabaseRecommendationService,
  ) {}

  /**
   * Connects to database and updates modules list and last connected time
   * @param clientMetadata
   */
  async connect(clientMetadata: ClientMetadata): Promise<void> {
    const client = await this.databaseClientFactory.getOrCreateClient(clientMetadata);

    // refresh modules list and last connected time
    // mark database as not a new
    // will be refreshed after user navigate to particular database from the databases list
    // Note: move to a different place in case if we need to update such info more often
    const toUpdate: Partial<Database> = {
      new: false,
      lastConnection: new Date(),
      timeout: client.options.connectTimeout,
      modules: await this.databaseInfoProvider.determineDatabaseModules(client),
      version: await this.databaseInfoProvider.determineDatabaseServer(client),
    };

    // !Temporary. Refresh cluster nodes on connection
    if (client?.getConnectionType() === RedisClientConnectionType.CLUSTER) {
      const primaryNodeOptions = (await client.nodes(RedisClientNodeRole.PRIMARY))[0].options;

      toUpdate.host = primaryNodeOptions.host;
      toUpdate.port = primaryNodeOptions.port;

      toUpdate.nodes = (await client.nodes()).map(({ options }) => ({
        host: options.host,
        port: options.port,
      }));
    }

    await this.repository.update(clientMetadata.databaseId, toUpdate);

    const generalInfo = await this.databaseInfoProvider.getRedisGeneralInfo(client);

    this.recommendationService.check(
      clientMetadata,
      RECOMMENDATION_NAMES.REDIS_VERSION,
      generalInfo,
    );
    this.recommendationService.check(
      clientMetadata,
      RECOMMENDATION_NAMES.LUA_SCRIPT,
      generalInfo,
    );
    this.recommendationService.check(
      clientMetadata,
      RECOMMENDATION_NAMES.BIG_AMOUNT_OF_CONNECTED_CLIENTS,
      generalInfo,
    );
    this.recommendationService.check(
      clientMetadata,
      RECOMMENDATION_NAMES.LUA_TO_FUNCTIONS,
      { client, databaseId: clientMetadata.databaseId, info: generalInfo },
    );
    this.recommendationService.check(
      clientMetadata,
      RECOMMENDATION_NAMES.FUNCTIONS_WITH_KEYSPACE,
      { client, databaseId: clientMetadata.databaseId },
    );

    this.collectClientInfo(clientMetadata, client, generalInfo?.version);

    this.logger.log(`Succeed to connect to database ${clientMetadata.databaseId}`);
  }

  private async collectClientInfo(clientMetadata: ClientMetadata, client: RedisClient, version?: string) {
    try {
      const intVersion = parseInt(version, 10) || 0;
      const clients = await this.databaseInfoProvider.getClientListInfo(client) || [];

      this.analytics.sendDatabaseConnectedClientListEvent(
        clientMetadata.databaseId,
        {
          clients: clients.map((c) => ({
            version: version || 'n/a',
            resp: intVersion < 7 ? undefined : c?.['resp'] || 'n/a',
            libName: intVersion < 7 ? undefined : c?.['lib-name'] || 'n/a',
            libVer: intVersion < 7 ? undefined : c?.['lib-ver'] || 'n/a',
          })),
        },
      );
    } catch (error) {
      // ignore errors
    }
  }
}
