const ServerlessBase = require('./ServerlessBase')
const s3 = require('@monolambda/s3')

class Storage extends ServerlessBase {

    constructor(serverless, options, credentials) {
        super(serverless, options)
        this.cloudformation = new this.serverless.providers.aws.sdk.CloudFormation(credentials)
        const s3Client = new this.serverless.providers.aws.sdk.S3(credentials)
        this.s3 = s3Client
        this.s3ex = s3.createClient({ s3Client })
    }

    /**
     * S3デプロイ
     * サービスバケットの作成と同期を行う
     * @returns Promise<>
     */
    async deploy () {
        return new Promise(async (resolve, reject) => {
            try {
                this.title(`[Storage::deploy] start deploy`)
                // 動作に必要な変数のセット
                await this._assignVariables()
                // バケット作成
                await this._createBucketIfNotExist(this.serviceBucketName)
                // バケット内ファイルの同期
                await this._syncBucketContents()
                //
                resolve(`[Storage::deploy] deployed`)
            } catch (err) {
                this.error(err)
                reject(err)
            }
        })
    }

    /**
     * S3コンテンツ削除
     * サービスバケット内コンテンツの削除とバケットの削除を行う
     * cloudfrontログがあった場合はエラーとなるので削除されない
     */
    async remove () {
        return new Promise(async (resolve, reject) => {
            try {
                this.title(`[Storage::remove] start remove`)
                // 動作に必要な変数のセット
                await this._assignVariables()
                // バケット内ファイルの削除
                await this._removeBucketContents()
                //
                resolve(`[Storage::remove] removed`)
            } catch (err) {
                this.error(err)
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
                this.info(`[Storage::getRestApiId] Found the RestApiId: ${apiGateway.restApiId}`)
                return apiGateway.restApiId
            }
            const stackName = this.serverless.service.provider.stackName || `${this.basename}`
            let response
            try {
                response = await this.cloudformation.describeStackResource({
                    StackName: stackName,
                    LogicalResourceId: 'ApiGatewayRestApi'
                }).promise()
            } catch (err) {
                return reject(`[Storage::getRestApiId] Could not find CloudFormation resources for ${this.serviceName}, stackName: ${stackName}`)
            }
            if (!response) {
                return reject(`[Storage::getRestApiId] Could not get CloudFormation resources for ${this.serviceName}, stackName: ${stackName}`)
            }
            const restApiId = response.StackResourceDetail.PhysicalResourceId
            if (!restApiId) {
                return reject(`[Storage::getRestApiId] No RestApiId associated with CloudFormation stack ${stackName}`)
            }
            this.info(`[Storage::getRestApiId] Found the RestApiId: ${restApiId}`)
            resolve(restApiId)
        })
    }

    /**
     * バケット内ファイルの同期
     * @returns Promise<String[]> syncDirectories
     */
    async _syncBucketContents() {
        return new Promise(async (resolve) => {
            // ディレクトリ同期
            let directories = []
            this.info(`[Storage::syncBucketContents] syncing directories`)
            for (let setting of this.serverless.service.custom.nuxtDeploy.sync) {
                if (setting.type == 's3') {
                    this.info(`[Storage::syncBucketContents] => ${setting.path}`)
                    await this._syncDirectory(setting.localDir, setting.path).catch(err => {
                        this.error(`[Storage::syncBucketContents] Error: ${err}`)
                    })
                    directories.push(setting.path)
                }
            }
            resolve(directories)
        })
    }
    async _syncDirectory(localDir, prefix) {
        return new Promise(async (resolve, reject) => {
            const uploader = this.s3ex.uploadDir({
                localDir: [this.servicePath, localDir].join('/'),
                deleteRemoved: true,
                s3Params: {
                    Bucket: this.serviceBucketName,
                    Prefix: prefix
                }
            })
            uploader.on('error', err => { reject(err.message) })
            uploader.on('end', () => { resolve('done') })
        })
    }

    /**
     * バケット内ファイルの削除
     * @returns Promise<String[]> removeDirectories
     */
    async _removeBucketContents() {
        return new Promise(async (resolve, reject) => {
            // バケット存在確認
            const exist = await this._isExistBucket()
            // バケットが存在しない場合は終了とする
            if (!exist) {
                this.warn(`[Storage::removeBucketContents] Not found static bucket: ${this.serviceBucketName}`)
                return resolve(`[Storage::removeBucketContents] Not found static bucket: ${this.serviceBucketName}`)
            }
            // ディレクトリ削除
            let directories = []
            this.info(`[Storage::removeBucketContents] removing directories`)
            for (let setting of this.serverless.service.custom.nuxtDeploy.sync) {
                if (setting.type == 's3') {
                    this.info(`[Storage::removeBucketContents] => ${setting.path}`)
                    await this._removeDirectory(setting.path).catch(err => {
                        this.error(`[Storage::removeBucketContents] Error: ${err}`)
                    })
                    directories.push(setting.path)
                }
            }
            // バケット削除
            this.info(`[Storage::removeBucketContents] removing bucket`)
            try {
                await this.s3.deleteBucket({Bucket: this.serviceBucketName}).promise()
                this.info(`[Storage::removeBucketContents] => removed`)
                resolve(directories)
            } catch (err) {
                this.warn(`[Storage::removeBucketContents] Could not remove bucket: ${err.message}`)
                resolve(directories)
            }
        })
    }
    async _removeDirectory(prefix) {
        return new Promise(async (resolve, reject) => {
            const uploader = this.s3ex.deleteDir({
                Bucket: this.serviceBucketName,
                Prefix: prefix
            })
            uploader.on('error', err => { reject(err) })
            uploader.on('end', () => { resolve('done') })
        })
    }

    /**
     * バケット作成
     * @param String bucketName
     * @returns Promise<String> bucketName
     */
    async _createBucketIfNotExist(bucketName) {
        return new Promise(async (resolve, reject) => {
            try {
                let isExist = await this._isExistBucket(bucketName)
                if (!isExist) {
                    await this.s3.createBucket({
                        Bucket: bucketName,
                        CreateBucketConfiguration: {
                            LocationConstraint: this.region
                        }
                    }).promise()
                }
                resolve(bucketName)
            } catch (err) {
                reject(`[Storage::createBucketIfNotExist] Error: ${err.message}`)
            }
        })
    }

    /**
     * バケットの存在確認をする
     * @param String bucketName
     * @returns Promise<Boolean>
     */
    async _isExistBucket(bucketName) {
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

}
module.exports = Storage