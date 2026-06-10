// ================================================================
// APP ENTRY POINT
// ================================================================
import * as cdk from 'aws-cdk-lib';
import { WebAppPipelineStack } from '../lib/pipeline';
import { WebAppInfrastructureStack } from '../lib/stack';

const app = new cdk.App();

// 1. CI/CD CodePipeline Stack
new WebAppPipelineStack(app, 'WebAppPipelineStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});

// 2. Staging Infrastructure Stack (Synthesized for Pipeline Stage)
new WebAppInfrastructureStack(app, 'StagingInfrastructureStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});

// 3. Production Infrastructure Stack (Synthesized for Pipeline Stage)
new WebAppInfrastructureStack(app, 'ProductionInfrastructureStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});

app.synth();