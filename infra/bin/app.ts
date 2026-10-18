import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';

const app = new App();
new DataStack(app, 'FoodNgoDataStack');
