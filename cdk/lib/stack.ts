import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

export class WebAppInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // 1. DATA STORAGE & REGISTRY (DYNAMODB & S3)
    // =========================================================================

    // A. Room & WebSocket Connection Registry Table
    const connectionTable = new dynamodb.Table(this, 'WebSocketConnections', {
      partitionKey: { name: 'RoomId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ConnectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL', // Auto-cleanup dead connection sessions for $0 cost
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev convenience, destroy on stack teardown
    });

    // B. Incremental Mutation Ledger Table (For clients alone online)
    const mutationTable = new dynamodb.Table(this, 'AppMutations', {
      partitionKey: { name: 'UserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'Hlc', type: dynamodb.AttributeType.STRING }, // Ordered by logical clock
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // C. Amazon S3 Heavy Storage Vault (Zipped snapshots, attachments, files)
    const backupBucket = new s3.Bucket(this, 'HeavyStorageVault', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Secure private bucket
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // =========================================================================
    // 2. RUNTIMELESS SIGNALING GATEWAY (WEBSOCKET API GATEWAY VTL DYNAMODB)
    // =========================================================================

    // IAM Role allowing API Gateway to read/write to DynamoDB and post messages back to WebSockets
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayServiceRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    connectionTable.grantReadWriteData(apiGatewayRole);
    mutationTable.grantReadWriteData(apiGatewayRole);
    backupBucket.grantReadWrite(apiGatewayRole);

    // Add APIGw post-back permission
    apiGatewayRole.addToPolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: ['arn:aws:execute-api:*:*:*'],
    }));

    // Define the WebSocket API
    const webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketSignalingApi', {
      name: 'P2P-Signaling-WebSocket-API',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // A. $connect Integration (VTL -> DynamoDB PutItem)
    // When a client connects, VTL maps query parameters directly into the DynamoDB connection registry.
    // ZERO Lambdas are executed.
    const connectIntegration = new apigatewayv2.CfnIntegration(this, 'ConnectIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS',
      integrationUri: `arn:aws:apigateway:${this.region}:dynamodb:action/PutItem`,
      credentialsArn: apiGatewayRole.roleArn,
      requestTemplates: {
        'application/json': JSON.stringify({
          TableName: connectionTable.tableName,
          Item: {
            RoomId: { S: '$input.params(\'roomId\')' },
            ConnectionId: { S: '$context.connectionId' },
            // TTL set to current epoch seconds + 86400 (24 hours) for DynamoDB cleanup
            TTL: { N: '$math.round($math.add($math.div($context.requestTimeEpoch, 1000), 86400))' }
          }
        })
      },
      templateSelectionExpression: '\\$default',
      passthroughBehavior: 'NEVER',
    });

    new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    // B. $disconnect Integration (VTL -> DynamoDB DeleteItem)
    // When a client disconnects, VTL removes their connectionId from the DynamoDB registry.
    // ZERO Lambdas are executed.
    const disconnectIntegration = new apigatewayv2.CfnIntegration(this, 'DisconnectIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS',
      integrationUri: `arn:aws:apigateway:${this.region}:dynamodb:action/DeleteItem`,
      credentialsArn: apiGatewayRole.roleArn,
      requestTemplates: {
        'application/json': JSON.stringify({
          TableName: connectionTable.tableName,
          Key: {
            RoomId: { S: '$input.params(\'roomId\')' }, // Required key
            ConnectionId: { S: '$context.connectionId' }
          }
        })
      },
      templateSelectionExpression: '\\$default',
      passthroughBehavior: 'NEVER',
    });

    new apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$disconnect',
      target: `integrations/${disconnectIntegration.ref}`,
    });

    // C. P2P Signal Route (Direct APIGw post-back proxy)
    // Client A sends a message to Client B via its connectionId.
    // API Gateway directly proxies the payload to Client B's WebSocket connection endpoint.
    // ZERO Lambdas are executed.
    const signalIntegration = new apigatewayv2.CfnIntegration(this, 'SignalIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS',
      integrationUri: `arn:aws:apigateway:${this.region}:apigateway:path/%2Fconnections%2F{connectionId}`,
      credentialsArn: apiGatewayRole.roleArn,
      requestParameters: {
        'integration.request.path.connectionId': 'method.request.body.targetConnectionId'
      },
      passthroughBehavior: 'WHEN_NO_MATCH',
    });

    new apigatewayv2.CfnRoute(this, 'SignalRoute', {
      apiId: webSocketApi.ref,
      routeKey: 'signal',
      target: `integrations/${signalIntegration.ref}`,
    });

    // Create stage and deploy the WebSockets
    const webSocketStage = new apigatewayv2.CfnStage(this, 'ProdStage', {
      apiId: webSocketApi.ref,
      stageName: 'prod',
      autoDeploy: true,
    });

    // =========================================================================
    // 3. RUNTIMELESS CLOUD VAULT PROXY (API GATEWAY REST PRIVATE S3 PROXY)
    // =========================================================================

    // API Gateway REST API acting as a secure proxy to private S3 bucket storage.
    // Clients PUT and GET files directly into S3 via this API without any Lambda middleware.
    // ZERO Lambdas are executed.
    const cloudVaultApi = new apigateway.RestApi(this, 'PWACloudVaultApi', {
      restApiName: 'PWA Cloud Vault Backup Proxy API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // CloudFront handles single-domain, this is backup
        allowMethods: ['GET', 'PUT', 'DELETE'],
      },
    });

    // Dynamic S3 Path Variable: /vault/{userId}/{key}
    const vaultResource = cloudVaultApi.root.addResource('vault');
    const userResource = vaultResource.addResource('{userId}');
    const keyResource = userResource.addResource('{key}');

    // A. PUT Attachment / Mutations (Proxy to S3 PUT)
    const s3PutIntegration = new apigateway.AwsIntegration({
      service: 's3',
      integrationHttpRequestMethod: 'PUT',
      path: `${backupBucket.bucketName}/{userId}/{key}`,
      options: {
        credentialsRole: apiGatewayRole,
        requestParameters: {
          'integration.request.path.userId': 'method.request.path.userId',
          'integration.request.path.key': 'method.request.path.key',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      },
    });

    keyResource.addMethod('PUT', s3PutIntegration, {
      requestParameters: {
        'method.request.path.userId': true,
        'method.request.path.key': true,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseHeaders: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    });

    // B. GET Attachment / Mutations (Proxy to S3 GET)
    const s3GetIntegration = new apigateway.AwsIntegration({
      service: 's3',
      integrationHttpRequestMethod: 'GET',
      path: `${backupBucket.bucketName}/{userId}/{key}`,
      options: {
        credentialsRole: apiGatewayRole,
        requestParameters: {
          'integration.request.path.userId': 'method.request.path.userId',
          'integration.request.path.key': 'method.request.path.key',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      },
    });

    keyResource.addMethod('GET', s3GetIntegration, {
      requestParameters: {
        'method.request.path.userId': true,
        'method.request.path.key': true,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseHeaders: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    });

    // =========================================================================
    // 4. CLOUDFRONT EDGE ROUTER (SINGLE-DOMAIN PRIVACY & LATENCY OPTIMIZATION)
    // =========================================================================

    // Private S3 bucket for hosting PWA frontend static assets
    const frontendBucket = new s3.Bucket(this, 'PWAFrontendBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // CloudFront Origin Access Control (OAC) to access private S3 bucket safely
    const cloudfrontOAC = new cloudfront.CfnOriginAccessControl(this, 'CF-OAC', {
      originAccessControlConfig: {
        name: 'OAC-PWAFrontendBucket',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    // Grant CloudFront read permissions to private S3 bucket
    frontendBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [frontendBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/*`,
        },
      },
    }));

    // CloudFront Distribution mapping the entire platform to a single domain
    const distribution = new cloudfront.Distribution(this, 'PWADistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // Error fallback for Single Page Application (SPA) routing (e.g. refresh on nested views)
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // Add API Gateway Rest API as an edge path origin on the same domain (/api/*)
    // Completely solves CORS and conceals underlying AWS resource structures!
    distribution.addBehavior('/api/*', new origins.RestApiOrigin(cloudVaultApi), {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // Live APIs must not be cached!
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    // =========================================================================
    // 5. STACK OUTPUTS
    // =========================================================================
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'The unified, secure single-domain URL mapping S3 frontend and API S3 proxy.',
    });

    new cdk.CfnOutput(this, 'WebSocketUri', {
      value: `wss://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/prod`,
      description: 'Regional runtimeless WebSocket Signaling gateway endpoint.',
    });
  }
}
