# Serverless Nuxt Deploy

通常の使い方
```
sls deploy --stage {stage}
sls cloudfront:deploy --stage {stage}
```

ストレージだけ個別
```
sls storage:deploy --stage {stage}
sls storage:remove --stage {stage}
```

クラウドフロントのセットアップ
```
sls cloudfront:deploy --stage {stage}
sls cloudfront:remove --stage {stage}
```

serverless.ymlの設定
```
...

custom:
  nuxtDeploy:
    domain: hoge.example.com
    behaviors:
      - path: _nuxt
        type: s3
        localDir: .nuxt/dist/client
      - path: img
        type: s3
        localDir: app/static/img
      - path: api
        type: proxy
        endpoint: http://backend.hoge.example.com
        methods:
          - GET
          - HEAD
          - POST
          - PUT
          - PATCH
          - OPTIONS
          - DELETE
        headers:
          - Authorization
          - X-Authorization
          - Origin
          - Host

```
