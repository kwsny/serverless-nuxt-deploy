const ServerlessBase = require('./ServerlessBase')
const { CloudFrontProxyOriginConfig, CloudFrontS3OriginConfig, 
    CloudFrontProxyBehaviorConfig, CloudFrontS3BehaviorConfig,
    CloudFrontConfigBuilder} = require('./CloudFrontConfigBuilder')

class CloudFront extends ServerlessBase {

    constructor (serverless, options, credentials) {
        super(serverless, options)
        this.cloudformation = new this.serverless.providers.aws.sdk.CloudFormation(credentials)
        this.route53 = new this.serverless.providers.aws.sdk.Route53(credentials)
        this.acm = new this.serverless.providers.aws.sdk.ACM({
            credentials: credentials.credentials,
            region: 'us-east-1'
        })
        this.cloudfront = new this.serverless.providers.aws.sdk.CloudFront(credentials)
        this.s3 = new this.serverless.providers.aws.sdk.S3(credentials)
    }

    /**
     * CloudFrontディストリビューション作成
     * APIGatewayのデプロイ、証明書の生成は終わらせておくこと
     * @returns Promise<>
     */
    async deploy () {
        return new Promise(async (resolve, reject) => {
            try {
                this.title(`[CloudFront:deploy] start deploy`)
                // 動作に必要な変数のセット
                await this._assignVariables()
                // 証明書情報の取得
                this.certificateArn = await this._getCertificateArn(this.domain)
                // S3バケットの存在確認
                await this._checkBucket()
                // ディストリビューション生成
                this.cloudFrontDomainName = await this._createDistribution()
                // DNSレコードの作成
                await this._updateDNSRecord(this.hostedZoneId, this.domain, this.cloudFrontDomainName)
                // 後処理
                this.info(`[CloudFront:deploy] deployed`)
                resolve()
            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * ディストリビューション削除
     */
    async remove () {
        return new Promise(async (resolve, reject) => {
            try {
                this.title(`[CloudFront:remove] start remove`)
                // 動作に必要な変数のセット
                await this._assignVariables()
                // ディストリビューションを検索
                let domainInfo = await this._findDistribution(this.domain)
                // DNSレコードの削除
                await this._deleteDNSRecord(this.hostedZoneId, this.domain, domainInfo.domain).catch(err => {
                    this.error(err)
                })
                // ディストリビューション削除
                await this._deleteDistribution(domainInfo.id)
                // 後処理
                this.info(`[CloudFront:remove] removed`)
                resolve()
            } catch (err) {
                reject(err)
            }
        })
    }

    /***************************************/

    /**
     * 動作に必要な変数をセットする
     * @returns Promise<>
     */
    async _assignVariables () {
        return new Promise(async (resolve, reject) => {
            try {
                // APIGatewayデプロイ確認
                this.restApiId = await this._getRestApiId()
                // バケット名の設定
                this.serviceBucketName = `${this.basename}-${this.restApiId}`
                // ドメイン情報の取得
                this.hostedZoneId = await this._getHostedZoneId(this.domain)
                //
                resolve()
            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * APIGatewayのIDを取得する
     * @returns Promise<String> RestApiId
     */
    async _getRestApiId () {
        return new Promise(async (resolve, reject) => {
            const apiGateway = this.serverless.service.provider.apiGateway
            if (apiGateway && apiGateway.restApiId) {
                this.info(`[CloudFront::getRestApiId] Found the RestApiId: ${apiGateway.restApiId}`)
                return apiGateway.restApiId
            }
            const stackName = this.serverless.service.provider.stackName || `${this.basename}`
            let response
            try {
                response = await this.cloudformation.describeStackResource({
                    LogicalResourceId: 'ApiGatewayRestApi',
                    StackName: stackName
                }).promise()
            } catch (err) {
                return reject(`[CloudFront::getRestApiId] Could not find CloudFormation resources for ${this.serviceName}, stackName: ${stackName}`)
            }
            if (!response) {
                return reject(`[CloudFront::getRestApiId] Could not get CloudFormation resources for ${this.serviceName}, stackName: ${stackName}`)
            }
            const restApiId = response.StackResourceDetail.PhysicalResourceId
            if (!restApiId) {
                return reject(`[CloudFront::getRestApiId] No RestApiId associated with CloudFormation stack ${stackName}`)
            }
            this.info(`[CloudFront::getRestApiId] Found the RestApiId: ${restApiId}`)
            resolve(restApiId)
        })
    }

    /**
     * ドメイン名を元にHostedZoneIdを取得する
     * @param String domainName ドメイン名
     * @returns Promise<String> HostedZoneId
     */
    async _getHostedZoneId (domainName) {
        return new Promise(async (resolve, reject) => {
            try {
                let domains = await this.route53.listHostedZones().promise()
                for (let domain of domains.HostedZones) {
                    let rg = new RegExp(`${domain.Name.replace(/\.$/, '')}$`)
                    if (rg.test(domainName)) {
                        const hostedZoneId = domain.Id.replace('/hostedzone/', '')
                        this.info(`[CloudFront:getDomainInfo] Found the domain '${domainName}'`)
                        this.info(`[CloudFront:getDomainInfo] HostedZoneId: ${hostedZoneId}`)
                        return resolve(hostedZoneId)
                    }
                }
                reject(`[CloudFront:getDomainInfo] Not found the domain '${domainName}' from Route53`)
            } catch (err) {
                reject(`[CloudFront:getDomainInfo] Error: ${err.message}`)
            }
        })
    }

    /**
     * ドメイン名を元にCertificateArnを取得する
     * CloudFront用の証明書を取得する必要があるので
     * @param String domainName ドメイン名
     * @returns Promise<String> CertificateArn
     */
    async _getCertificateArn (domainName) {
        return new Promise(async (resolve, reject) => {
            try {
                let certificates = await this.acm.listCertificates().promise()
                for (let certificate of certificates.CertificateSummaryList) {
                    let rg = new RegExp(`${certificate.DomainName}$`)
                    if (certificate.DomainName == domainName || rg.test(domainName)) {
                        const certificateArn = certificate.CertificateArn
                        this.info(`[CloudFront:getCertificateArn] Found the certificate for '${domainName}'.`)
                        this.info(`[CloudFront:getCertificateArn] CertificateArn: ${certificateArn}`)
                        return resolve(certificateArn)
                    }
                }
                reject(`[CloudFront:getCertificateArn] Not found the certificate for '${domainName}' from ACM (region us-east-1)`)
            } catch (err) {
                reject(`[CloudFront:getCertificateArn] Error: ${err.message}`)
            }
        })
    }

    /**
     * サービス用バケットの存在確認をする
     * @returns Promise<String> チェックしたバケット名
     */
    async _checkBucket () {
        return new Promise(async (resolve, reject) => {
            // staticバケットの存在確認
            let serviceBucket = await this._isExistsBucket(this.serviceBucketName)
            if (!serviceBucket) {
                return reject(`[CloudFront::checkBuckets] Not found the static bucket '${this.serviceBucketName}'`)
            }
            resolve(this.serviceBucketName)
        })
    }

    /**
     * バケットの存在確認をする
     * @returns Promise<Boolean>
     */
    async _isExistsBucket (bucketName) {
        return new Promise(async (resolve) => {
            try {
                const buckets = await this.s3.listBuckets().promise()
                if (buckets.Buckets.find(bucket => bucket.Name == bucketName)) {
                    resolve(true)
                } else {
                    resolve(false)
                }
            } catch (err) {
                resolve(false)
            }
        })
    }

    /**
     * CloudFrontOriginAccessIdentityの生成
     * @param String callerReference 
     * @returns Promise<String> CloudFrontOriginAccessIdentity
     */
    async _createCloudFrontOriginAccessIdentity (callerReference) {
        return new Promise(async (resolve, reject) => {
            try {
                const identity = await this.cloudfront.createCloudFrontOriginAccessIdentity({
                    CloudFrontOriginAccessIdentityConfig: {
                        CallerReference: callerReference,
                        Comment: `Created by ServerlessNuxtDeploy for '${this.domain}'`
                    }
                }).promise()
                resolve(identity.CloudFrontOriginAccessIdentity.Id)
            } catch (err) {
                reject(`[CloudFront::createCloudFrontOriginAccessIdentity] Error: ${err.message}`)
            }
        })
    }

    /**
     * CloudFrontディストリビューションの生成
     * @returns Promise<String> DomainName
     */
    async _createDistribution () {
        return new Promise(async (resolve, reject) => {
            try {
                const config = new CloudFrontConfigBuilder({
                    domain: this.domain,
                    certificateArn: this.certificateArn,
                    loggingBucketName: this.serviceBucketName,
                })
                // APIGateway Origin
                const apiGatewayEndpoint = `https://${this.restApiId}.execute-api.${this.region}.amazonaws.com/${this.stage}`
                const apiGatewayOrigin = new CloudFrontProxyOriginConfig(apiGatewayEndpoint)
                config.origins.push(apiGatewayOrigin)
                // S3 Origin
                const originAccessIdentity = await this._createCloudFrontOriginAccessIdentity(config.id)
                const s3Endpoint = `https://${this.serviceBucketName}.s3.amazonaws.com`
                const s3Origin = new CloudFrontS3OriginConfig(s3Endpoint, originAccessIdentity)
                config.origins.push(s3Origin)
                // Default Behavior (APIGatway)
                config.cacheBehaviors.push(new CloudFrontProxyBehaviorConfig(apiGatewayOrigin.id))
                // Cache Behaviors
                for (let behavior of this.serverless.service.custom.nuxtDeploy.behaviors) {
                    if (behavior.type == 's3') {
                        config.cacheBehaviors.push(new CloudFrontS3BehaviorConfig(
                            s3Origin.id, `/${behavior.path}/*`, 3600
                        ))
                    } else if (behavior.type == 'proxy') {
                        // Create Custom Origin
                        const proxyOrigin = new CloudFrontProxyOriginConfig(behavior.endpoint)
                        config.origins.push(proxyOrigin)
                        // Create Cache Behavior
                        config.cacheBehaviors.push(new CloudFrontProxyBehaviorConfig(
                            proxyOrigin.id, `/${behavior.path}/*`, 
                            behavior.methods || ['GET', 'HEAD'],
                            behavior.headers || ['Authorization', 'Origin', 'Host']
                        ))
                    }
                }
                try {
                    const settings = config.build()
                    let distribution = await this.cloudfront.createDistribution(settings).promise()
                    this.info(`[CloudFront::createDistribution] ID: ${distribution.Distribution.Id}`)
                    this.info(`[CloudFront::createDistribution] DomainName: ${distribution.Distribution.DomainName}`)
                    resolve(distribution.Distribution.DomainName)
                } catch (err) {
                    reject(`[CloudFront::createDistribution] Error: ${err.message}`)
                }
            } catch (err) {
                reject(`[CloudFront::createDistribution] Error: ${err}`)
            }
        })
    }

    /**
     * CloudFrontディストリビューションの生成
     * @param Object dist
     * @returns Promise<String> id
     */
    async _deleteDistribution (id) {
        return new Promise(async (resolve, reject) => {
            try {
                let distribution = await this.cloudfront.getDistribution({
                    Id: id
                }).promise()
                if (distribution.Distribution.DistributionConfig.Enabled) {
                    let settings = {
                        Id: distribution.Distribution.Id,
                        IfMatch: distribution.ETag,
                        DistributionConfig: distribution.Distribution.DistributionConfig
                    }
                    settings.DistributionConfig.Enabled = false
                    this.info(`[CloudFront::deleteDistribution] disable distribution`)
                    await this.cloudfront.updateDistribution(settings).promise()
                }
                this.info(`[CloudFront::deleteDistribution] disabling distribution`)
                try {
                    await this.__deleteDistributionWhenDisabled(id)
                    this.info(`[CloudFront::deleteDistribution] deleted`)
                    resolve(id)
                } catch (err) {
                    reject(err)
                }
            } catch (err) {
                reject(`[CloudFront::deleteDistribution] Error: ${err.message}`)
            }
        })
    }
    async __deleteDistributionWhenDisabled (id) {
        return new Promise(async (resolve, reject) => {
            try {
                let distribution = await this.cloudfront.getDistribution({
                    Id: id
                }).promise()
                this.info(`disabling... ${distribution.Distribution.Status}`)
                if (!distribution.Distribution.DistributionConfig.Enabled && distribution.Distribution.Status == 'Deployed') {
                    await this.cloudfront.deleteDistribution({
                        Id: distribution.Distribution.Id,
                        IfMatch: distribution.ETag
                    }).promise()
                    resolve(id)
                } else {
                    setTimeout(async () => {
                        await this.__deleteDistributionWhenDisabled(id)
                    }, 30000)
                }
            } catch (err) {
                reject(`[CloudFront::deleteDistributionWhenDisabled] Error: ${err}`)
            }
        })
    }

    /**
     * ドメイン名からディストリビューションを探す
     * Aliasから探す
     * @param String domainName 
     * @returns Promise<Object> {id, domain}
     */
    async _findDistribution (domainName) {
        return new Promise(async (resolve, reject) => {
            try {
                let distributions = await this.cloudfront.listDistributions().promise()
                for (let dist of distributions.DistributionList.Items) {
                    if (dist.Aliases.Quantity > 0) {
                        let alias = dist.Aliases.Items.find(item => item === domainName)
                        if (alias !== undefined) {
                            // get detail
                            let distribution = await this.cloudfront.getDistribution({
                                Id: dist.Id
                            }).promise()
                            return resolve({
                                id: distribution.Distribution.Id,
                                domain: distribution.Distribution.DomainName,
                                etag: distribution.ETag
                            })
                        }
                    }
                }
                reject(`[CloudFront::findDistribution] Not found distribution for '${domainName}'`)
            } catch (err) {
                reject(`[CloudFront::findDistribution] Could not get distribution`)
            }
        })
    }

    /**
     * DNSレコードの更新
     * 転送先ドメイン向けにA(Alias)を作成する
     * @param String hostedZoneId 
     * @param String domainName 
     * @param String targetDomainName 転送先ドメイン
     */
    async _updateDNSRecord (hostedZoneId, domainName, targetDomainName) {
        return new Promise(async (resolve, reject) => {
            try {
                await this._changeResourceRecordSet('UPSERT', hostedZoneId, domainName, targetDomainName)
                resolve(domainName)
            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * DNSレコードの削除
     * @param String hostedZoneId 
     * @param String domainName 
     * @param String targetDomainName 転送先ドメイン
     */
    async _deleteDNSRecord (hostedZoneId, domainName, targetDomainName) {
        return new Promise(async (resolve, reject) => {
            try {
                await this._changeResourceRecordSet('DELETE', hostedZoneId, domainName, targetDomainName)
                resolve(domainName)
            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * DNSレコードの操作
     * @param String action 
     * @param String hostedZoneId
     * @param String domainName
     * @param String targetDomainName
     */
    async _changeResourceRecordSet (action, hostedZoneId, domainName, targetDomainName) {
        return new Promise(async (resolve, reject) => {
            if (action !== 'UPSERT' && action !== 'DELETE') {
                return reject(`[CustomDomain::changeResourceRecordSet] Invalid action "${action}"`)
            }
            try {
                await this.route53.changeResourceRecordSets({
                    ChangeBatch: {
                        Changes: [
                            {
                                Action: action,
                                ResourceRecordSet: {
                                    AliasTarget: {
                                        DNSName: targetDomainName,
                                        EvaluateTargetHealth: false,
                                        HostedZoneId: 'Z2FDTNDATAQYW2' // CloudFrontの場合は固定値
                                    },
                                    Name: domainName,
                                    Type: 'A'
                                }
                            }
                        ],
                        Comment: 'Record created by serverless-nuxt-deploy'
                    },
                    HostedZoneId: hostedZoneId
                }).promise()
                resolve(domainName)
            } catch (err) {
                reject(`[CloudFront::changeResourceRecordSet] Failed to change record for domain ${this.domain}`)
            }
        })
    }

}

module.exports = CloudFront