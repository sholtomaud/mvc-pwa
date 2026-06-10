import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as cloudformation from 'aws-cdk-lib/aws-cloudformation';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

export class WebAppPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ================================================================
    // S3 ARTIFACT BUCKET
    // ================================================================
    const artifactBucket = new s3.Bucket(this, 'PipelineArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ================================================================
    // PIPELINE SERVICE ROLE
    // ================================================================
    const pipelineRole = new iam.Role(this, 'PipelineServiceRole', {
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodePipeline_FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeBuildAdminAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCloudFormationFullAccess'),
      ],
    });

    artifactBucket.grantReadWrite(pipelineRole);

    // ================================================================
    // ARTIFACT OBJECTS
    // ================================================================
    const sourceOutput = new codepipeline.Artifact('SourceCodeOutput');
    const hygieneOutput = new codepipeline.Artifact('HygieneVerifiedOutput');
    const buildOutput = new codepipeline.Artifact('BuildArtifactsOutput');

    // ================================================================
    // CODEBUILD PROJECTS
    // ================================================================

    // -- Stage 1: Code Hygiene --
    const codeHygieneProject = new codebuild.PipelineProject(this, 'CodeHygieneBuildProject', {
      projectName: 'CodeHygieneBuildProject',
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'npm install',
              'pip install cfn-lint cfn-nag',
            ],
          },
          build: {
            commands: [
              'npm run test:unit',
              'npm run security:sast',
              'cfn-lint template.yaml',
              'cfn_nag_scan --input-path template.yaml',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // -- Stage 2: Asset Build --
    const assetBuildProject = new codebuild.PipelineProject(this, 'AssetBuildProject', {
      projectName: 'AssetBuildProject',
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'npm run build',
              'npm run test:bundle-budget',
            ],
          },
        },
        artifacts: {
          'base-directory': '.',
          files: ['**/*'],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // -- Stage 3: Local Integration --
    const localIntegrationProject = new codebuild.PipelineProject(this, 'LocalIntegrationProject', {
      projectName: 'LocalIntegrationProject',
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'npm run test:consumer-contract',
              'npm run test:integration',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // -- Stage 5: Post-Deployment Verification --
    const postDeploymentProject = new codebuild.PipelineProject(this, 'PostDeploymentVerificationProject', {
      projectName: 'PostDeploymentVerificationProject',
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'curl -f https://staging-api.yourdomain.com/health',
              'npm run security:dast',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // -- Stage 6: E2E & Performance --
    const e2ePerformanceProject = new codebuild.PipelineProject(this, 'E2EPerformanceProject', {
      projectName: 'E2EPerformanceProject',
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'npx playwright install --with-deps',
            ],
          },
          build: {
            commands: [
              'npx playwright test',
              'k6 run load-tests/stress.js',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        // Playwright needs a larger instance
        computeType: codebuild.ComputeType.LARGE,
      },
    });

    // ================================================================
    // PIPELINE
    // ================================================================
    const pipeline = new codepipeline.Pipeline(this, 'WebAppPipeline', {
      pipelineName: 'ComprehensiveWebAppPipeline',
      role: pipelineRole,
      artifactBucket,
      stages: [

        // ============================================================
        // STAGE 1: CODE VERIFICATION & HYGIENE
        // ============================================================
        {
          stageName: 'CodeVerificationAndHygiene',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'StaticAnalysisAndUnitTests',
              project: codeHygieneProject,
              input: sourceOutput,
              outputs: [hygieneOutput],
            }),
          ],
        },

        // ============================================================
        // STAGE 2: ARTIFACT BUILD & EVALUATION
        // ============================================================
        {
          stageName: 'ArtifactBuildAndEvaluation',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CompileAndCheckBudgets',
              project: assetBuildProject,
              input: hygieneOutput,
              outputs: [buildOutput],
            }),
          ],
        },

        // ============================================================
        // STAGE 3: LOCALIZED INTEGRATION
        // ============================================================
        {
          stageName: 'LocalizedIntegration',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'RunContractsAndIntegration',
              project: localIntegrationProject,
              input: buildOutput,
              type: codepipeline_actions.CodeBuildActionType.TEST,
            }),
          ],
        },

        // ============================================================
        // STAGE 4: DEPLOY INFRASTRUCTURE (STAGING)
        // ============================================================
        {
          stageName: 'DeployInfrastructure',
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'SpinUpStagingStack',
              stackName: 'staging-web-application-stack',
              templatePath: buildOutput.atPath('template.yaml'),
              adminPermissions: true,
              parameterOverrides: {
                Environment: 'staging',
              },
              extraInputs: [buildOutput],
            }),
          ],
        },

        // ============================================================
        // STAGE 5: POST-DEPLOYMENT VERIFICATION
        // ============================================================
        {
          stageName: 'PostDeploymentVerification',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'LiveApiAndDastInspection',
              project: postDeploymentProject,
              input: buildOutput,
              type: codepipeline_actions.CodeBuildActionType.TEST,
            }),
          ],
        },

        // ============================================================
        // STAGE 6: END-TO-END & PERFORMANCE GATES
        // ============================================================
        {
          stageName: 'E2EAndPerformanceGates',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'PlaywrightAndK6HeavyTesting',
              project: e2ePerformanceProject,
              input: buildOutput,
              type: codepipeline_actions.CodeBuildActionType.TEST,
            }),
          ],
        },

        // ============================================================
        // STAGE 7: TRAFFIC SWITCH / PROMOTION (PRODUCTION)
        // ============================================================
        {
          stageName: 'ProductionPromotion',
          actions: [
            // Manual gate — pipeline pauses until a human approves
            new codepipeline_actions.ManualApprovalAction({
              actionName: 'ManualQualityGateApproval',
              runOrder: 1,
            }),
            // Production deploy after approval
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'DeployToProductionLive',
              stackName: 'production-web-application-stack',
              templatePath: buildOutput.atPath('template.yaml'),
              adminPermissions: true,
              parameterOverrides: {
                Environment: 'production',
              },
              extraInputs: [buildOutput],
              runOrder: 2,
            }),
          ],
        },
      ],
    });
  }
}

