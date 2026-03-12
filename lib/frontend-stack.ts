import {
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
  Duration,
  Fn,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginAccessIdentity,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";

export class FrontendStack extends Stack {
  public readonly dist: Distribution;

  constructor(
    scope: Construct,
    id: string,
    props: StackProps & { appName: string },
  ) {
    super(scope, id, props);

    const bucket = new Bucket(this, "WebBucket", {
      bucketName: `${props.appName}-web-${this.account}-${this.region}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const oai = new OriginAccessIdentity(this, "OAI");
    bucket.grantRead(oai);

    const backendDomain = Fn.importValue(`${props.appName}-backend-domain`);

    this.dist = new Distribution(this, "Cdn", {
      defaultBehavior: {
        origin: new S3Origin(bucket, { originAccessIdentity: oai }),
      },
      additionalBehaviors: {
        "api/*": {
          origin: new HttpOrigin(backendDomain, {
            protocolPolicy: undefined,
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,

          cachePolicy: CachePolicy.CACHING_DISABLED,

          originRequestPolicy:
            OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,

          allowedMethods: AllowedMethods.ALLOW_ALL,
        },
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.seconds(0),
        },
      ],
    });

    new CfnOutput(this, "WebBucketName", { value: bucket.bucketName });
    new CfnOutput(this, "CloudFrontUrl", {
      value: `https://${this.dist.domainName}`,
    });
  }
}
