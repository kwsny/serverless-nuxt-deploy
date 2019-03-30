const uuid = require('uuid/v4')
const url = require('url')

class CloudFrontOriginConfig {
    constructor (endpoint) {
        this.id = uuid()
        const urlset = url.parse(endpoint)
        this.protocol = urlset.protocol.replace(':', '')
        this.domain = urlset.hostname
        this.path = urlset.pathname
        if (this.path == '/') {
            this.path = ''
        }
    }
    build () {
        let config = {
            Id: this.id,
            DomainName: this.domain,
            OriginPath: this.path
        }
        return config
    }
}
class CloudFrontProxyOriginConfig extends CloudFrontOriginConfig {
    constructor (endpoint) {
        super(endpoint)
    }
    build () {
        let config = super.build()
        if (this.protocol == 'http') {
            config.CustomOriginConfig = {
                HTTPPort: 80,
                OriginProtocolPolicy: `${this.protocol}-only`
            }
        } else if (this.protocol == 'https') {
            config.CustomOriginConfig = {
                HTTPPort: 80,
                HTTPSPort: 443,
                OriginProtocolPolicy: `${this.protocol}-only`,
                OriginSslProtocols: {
                    Quantity: 3,
                    Items: ['TLSv1', 'TLSv1.1', 'TLSv1.2']
                }
            }
        }
        return config
    }
}
class CloudFrontS3OriginConfig extends CloudFrontOriginConfig {
    constructor (endpoint, originAccessIdentity) {
        super(endpoint)
        this.originAccessIdentity = originAccessIdentity
    }
    build () {
        let config = super.build()
        config.S3OriginConfig = {
            OriginAccessIdentity: `origin-access-identity/cloudfront/${this.originAccessIdentity}`
        }
        return config
    }
}

class CloudFrontBehaviorConfig {
    constructor (origin, pathPattern=null) {
        this.origin = origin
        this.pathPattern = pathPattern
    }
    isDefault () {
        return this.pathPattern == null
    }
    build () {
        let config = {
            TargetOriginId: this.origin,
            ViewerProtocolPolicy: 'redirect-to-https',
            AllowedMethods: {
                Quantity: 2,
                Items: ['GET', 'HEAD'],
                CachedMethods: {
                    Quantity: 2,
                    Items: ['GET', 'HEAD']
                }
            },
            ForwardedValues: {
                Headers: {
                    Quantity: 0
                },
                Cookies: {
                    Forward: 'all',
                },
                QueryString: true
            },
            MinTTL: 0,
            MaxTTL: 0,
            DefaultTTL: 0,
            SmoothStreaming: false,
            TrustedSigners: {
                Enabled: false,
                Quantity: 0
            },
            Compress: false
        }
        // path pattern
        if (this.pathPattern) {
            config.PathPattern = this.pathPattern
        }
        return config
    }
}
class CloudFrontProxyBehaviorConfig extends CloudFrontBehaviorConfig {
    constructor (origin, pathPattern=null, allowedHttpMethods=null, forwardedHeaders=null) {
        super (origin, pathPattern)
        this.allowedHttpMethods = allowedHttpMethods || ['GET', 'HEAD']
        this.forwardedHeaders = forwardedHeaders || ['Authorization', 'Origin']
    }
    build () {
        let config = super.build()
        config.AllowedMethods.Quantity = this.allowedHttpMethods.length
        config.AllowedMethods.Items = this.allowedHttpMethods
        config.ForwardedValues.Headers = {
            Quantity: this.forwardedHeaders.length,
            Items: this.forwardedHeaders
        }
        return config
    }
}
class CloudFrontS3BehaviorConfig extends CloudFrontBehaviorConfig {
    constructor (origin, pathPattern, ttl=3600) {
        super(origin, pathPattern)
        this.ttl = ttl
    }
    build () {
        let config = super.build()
        config.ForwardedValues.Cookies.Forward = 'none'
        config.ForwardedValues.QueryString = false
        config.MinTTL = this.ttl
        config.MaxTTL = this.ttl
        config.DefaultTTL = this.ttl
        return config
    }
}

class CloudFrontConfigBuilder {
    constructor (config) {
        this.id = uuid()
        this.origins = config.origins || []
        this.cacheBehaviors = config.cacheBehaviors || []
        this.domain = config.domain || ''
        this.certificateArn = config.certificateArn || null
        this.loggingBucketName = config.loggingBucketName || null
        this.loggingPrefix = config.loggingPrefix || 'cloudfront'
        this.priceClass = config.priceClass || 'PriceClass_200'
    }

    build () {
        let config = {
            DistributionConfig: {
                Enabled: true,
                CallerReference: this.id,
                Comment: 'Managed by ServerlessNuxtDeploy',
                Origins: {
                    Quantity: this.origins.length,
                    Items: []
                },
                DefaultCacheBehavior: null,
                CacheBehaviors: {
                    Quantity: this.cacheBehaviors.length - 1,
                    Items: []
                },
                Logging: {
                    Enabled: true,
                    Bucket: `${this.loggingBucketName}.s3.amazonaws.com`,
                    IncludeCookies: false,
                    Prefix: this.loggingPrefix
                },
                PriceClass: this.priceClass,
                Aliases: {
                    Quantity: 1,
                    Items: [this.domain]
                },
                ViewerCertificate: {
                    CertificateSource: 'acm',
                    ACMCertificateArn: this.certificateArn,
                    MinimumProtocolVersion: 'TLSv1.1_2016',
                    SSLSupportMethod: 'sni-only'
                }
            }
        }
        // Origin
        for (let origin of this.origins) {
            config.DistributionConfig.Origins.Items.push(origin.build())
        }
        // Behaviors
        for (let behavior of this.cacheBehaviors) {
            if (behavior.isDefault()) {
                config.DistributionConfig.DefaultCacheBehavior = behavior.build()
            } else {
                config.DistributionConfig.CacheBehaviors.Items.push(behavior.build())
            }
        }
        // loggingなしの場合
        if (this.loggingBucketName == null) {
            config.Logging.Enabled = false
        }
        return config
    }

}
module.exports = {
    CloudFrontProxyOriginConfig,
    CloudFrontS3OriginConfig,
    CloudFrontProxyBehaviorConfig,
    CloudFrontS3BehaviorConfig,
    CloudFrontConfigBuilder
}