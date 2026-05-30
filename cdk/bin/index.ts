// ================================================================
// APP ENTRY POINT
// ================================================================
import * as cdk from 'aws-cdk-lib';
import { WebAppPipelineStack } from '../lib/stack';

const app = new cdk.App();
new WebAppPipelineStack(app, 'WebAppPipelineStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
app.synth();