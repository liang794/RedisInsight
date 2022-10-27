import { Module } from '@nestjs/common';
import { DatabaseService } from 'src/modules/database/database.service';
import { DatabaseController } from 'src/modules/database/database.controller';
import { DatabaseRepository } from 'src/modules/database/repositories/database.repository';
import { LocalDatabaseRepository } from 'src/modules/database/repositories/local.database.repository';
import { DatabaseAnalytics } from 'src/modules/database/database.analytics';
import { CertificateModule } from 'src/modules/certificate/certificate.module';
import { DatabaseConnectionService } from 'src/modules/database/database-connection.service';
import { DatabaseInfoProvider } from 'src/modules/database/providers/database-info.provider';
import { DatabaseFactory } from 'src/modules/database/providers/database.factory';
import { DatabaseInfoController } from 'src/modules/database/database-info.controller';
import { DatabaseInfoService } from 'src/modules/database/database-info.service';
import { ConfigurationBusinessService } from 'src/modules/shared/services/configuration-business/configuration-business.service';
import { DatabaseOverviewProvider } from 'src/modules/database/providers/database-overview.provider';

@Module({
  imports: [
    CertificateModule,
  ],
  controllers: [
    DatabaseController,
    DatabaseInfoController,
  ],
  providers: [
    DatabaseService,
    DatabaseConnectionService,
    DatabaseInfoProvider,
    DatabaseAnalytics,
    DatabaseFactory,
    DatabaseInfoService,
    DatabaseOverviewProvider,
    {
      provide: DatabaseRepository,
      useClass: LocalDatabaseRepository,
    },
    // todo: remove deps below
    ConfigurationBusinessService,
  ],
  exports: [
    DatabaseService,
    DatabaseConnectionService,
    // todo: rethink everything below
    DatabaseFactory,
    DatabaseInfoService,
    DatabaseInfoProvider,
  ],
})
export class DatabaseModule {}