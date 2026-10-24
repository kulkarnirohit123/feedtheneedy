import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { AdminApiStack } from '../lib/admin-api-stack';
import { ReportingStack } from '../lib/reporting-stack';
import { AlarmsStack } from '../lib/alarms-stack';
import { DashboardStack } from '../lib/dashboard-stack';
import { LandingStack } from '../lib/landing-stack';

const app = new App();
const data = new DataStack(app, 'FoodNgoDataStack');
const auth = new AuthStack(app, 'FoodNgoAuthStack');
const pipeline = new PipelineStack(app, 'FoodNgoPipelineStack', { data });
new AdminApiStack(app, 'FoodNgoAdminApiStack', { data, auth });
new ReportingStack(app, 'FoodNgoReportingStack', { data });
new AlarmsStack(app, 'FoodNgoAlarmsStack', { pipeline });
new DashboardStack(app, 'FoodNgoDashboardStack');
new LandingStack(app, 'FoodNgoLandingStack');
