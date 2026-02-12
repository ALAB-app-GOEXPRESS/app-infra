# infra 用リポジトリ

- こちらは AWS CDK で環境構築するためのリポジトリです
- リポジトリを複製して、サービス名などを適宜変更することで同様の環境を構築可能です

# 変更が必要な箇所

## /package.json

- `"name"`部分を`<サービス名>-infra`に変更
- `"bin"`のサービス名部分を併せて変更

## /bin/app.ts

- APP_NAMEの`"sample-app"`部分をサービス名に変更

## /lib/vpc-stack.ts

- `this.vpc = new Vpc(...)`内
  - `ipAddresses: IpAddresses.cidr("10.110.0.0/21"),`の IP アドレス部分を、他サービスの IP と被らないように設定
  - `subnetConfiguration: [...]`内のサブネット名を`<サービス名>-private-<数字>`に変更

## /lib/db-stack.ts

- 使いたい DB、バージョンに合わせて`this.db`内の`engine`, `version`を変更

## /lib/backend-stack.ts

- Springboot サーバーのスペックを`instanceConfiguration`で設定

# CDK でのデプロイ手順

## 前提

- Node.js / npm が使えること
- AWS CLI が使えること（`aws configure` で認証できること）
- CDK CLI が使えること（例: `npm i -g aws-cdk`）

1. **依存パッケージのインストール**

   ```bash
   npm install
   ```

2. **CDK のビルド（TypeScript の場合）**

   ```bash
   npm run build
   ```

3. **AWS アカウントの認証**

   ```bash
   aws configure
   ```

4. **CDK ブートストラップ（初回のみ）**

   ```bash
   cdk bootstrap aws://<AWS_ACCOUNT_ID>/ap-northeast-1
   ```

4.5. **スタック名の確認（任意）**

`APP_NAME` によってスタック名が変わるので、事前に一覧を出しておくと迷いにくいです。

```bash
cdk ls -c APP_NAME=<サービス名>
```

5. **デプロイ実行**

- 一般的には`cdk deploy`コマンドのみで上手くいきますが、初学者が詰まりやすいので「初回に安全な順番」を明記します。

### 推奨の順番（初回）

1. infra で VPC/DB/FE/ECR を作る
2. アプリ側リポ（ALAB-app-Sample-Template）で `frontend` / `backend` を作成してコミット
3. アプリ側リポの GitHub Actions（backend）で **まずは stub イメージ**を ECR に push
4. infra で BE（App Runner）を作る（`CREATE_BE_SERVICE=true`）
5. アプリ側リポの GitHub Actions（frontend）で FE を S3/CloudFront にデプロイ

> 補足: backend の Actions は、App Runner がまだ無い場合 `start-deployment` をスキップします。初回は「ECRへpush → infraでBE作成」が一番迷いません。

### 手順詳細（初回）

1. VPC/DB/FE/ECR のみ構築（BEはまだ作らない）
   ```bash
   cdk deploy <サービス名>-vpc <サービス名>-db <サービス名>-fe <サービス名>-ecr --require-approval never \
   -c APP_NAME=<サービス名> \
   -c CREATE_BE_SERVICE=false
   ```

   ※ DB のバックアップ保持日数を抑える場合は `DB_BACKUP_RETENTION_DAYS` を指定できます（デフォルト 1 日）

   ```bash
   cdk deploy <サービス名>-db --require-approval never \
   -c APP_NAME=<サービス名> \
   -c DB_BACKUP_RETENTION_DAYS=1
   ```

2. アプリケーション用リポジトリ（ALAB-app-Sample-Template）の Github Actions を実行し、BE 用イメージを ECR に push する
   - Spring Boot 未作成なら `Dockerfile.stub`
   - 作成済みなら `Dockerfile.gradle`

3. BE を構築
   ```bash
   cdk deploy <サービス名>-be --require-approval never \
   -c APP_NAME=<サービス名> \
   -c CREATE_BE_SERVICE=true
   ```

4. （任意）夜間停止/週末停止のスケジュールを構築（BE作成後が推奨）
   ```bash
   cdk deploy <サービス名>-schedule --require-approval never \
   -c APP_NAME=<サービス名> \
   -c ENABLE_SCHEDULE=true \
   -c SCHEDULE_WEEKDAYS_ONLY=true
   ```

5. アプリ側リポ（ALAB-app-Sample-Template）の GitHub Actions を実行し、FE を S3/CloudFront にデプロイする

> FE のデプロイは infra ではなく、アプリ側リポの `Build & Deploy Frontend to S3/CloudFront` を手動実行します。

## 夜間停止（コスト抑制）

- 業務時間外（デフォルト 20:00-8:00 JST）に RDS と App Runner を自動停止/再開するスケジュールを作成できます。
- 有効化する場合は `ENABLE_SCHEDULE=true` を指定してデプロイします。
- 土日を終日停止したい場合は、再開を平日のみにするため `SCHEDULE_WEEKDAYS_ONLY=true` を指定します。

```bash
cdk deploy <サービス名>-schedule --require-approval never \
-c APP_NAME=<サービス名> \
-c ENABLE_SCHEDULE=true \
-c SCHEDULE_WEEKDAYS_ONLY=true
```

※ `CREATE_BE_SERVICE=false` の状態でデプロイすると、App Runner 側のスケジュールは作成されず、DB のみが対象になります。BE を構築した後に、もう一度 `<サービス名>-schedule` をデプロイすると App Runner 側のスケジュールも作成されます。

## コピペ用（初回セットアップ一式）

```bash
# 変数を自分の環境に合わせて設定
APP_NAME=<サービス名>
AWS_ACCOUNT_ID=<AWS_ACCOUNT_ID>
REGION=ap-northeast-1

npm install
npm run build

cdk bootstrap aws://$AWS_ACCOUNT_ID/$REGION
cdk ls -c APP_NAME=$APP_NAME

# 1) まずは VPC/DB/FE/ECR（BEは作らない）
cdk deploy ${APP_NAME}-vpc ${APP_NAME}-db ${APP_NAME}-fe ${APP_NAME}-ecr --require-approval never \
   -c APP_NAME=$APP_NAME \
   -c CREATE_BE_SERVICE=false \
   -c DB_BACKUP_RETENTION_DAYS=1

# 2) アプリのGitHub Actions等でECRへイメージをpush後、BEを作成
cdk deploy ${APP_NAME}-be --require-approval never \
   -c APP_NAME=$APP_NAME \
   -c CREATE_BE_SERVICE=true

# 3) コスト抑制: 夜間停止 + 週末終日停止（平日だけ再開）
cdk deploy ${APP_NAME}-schedule --require-approval never \
   -c APP_NAME=$APP_NAME \
   -c ENABLE_SCHEDULE=true \
   -c SCHEDULE_WEEKDAYS_ONLY=true
```

6. **リソースの削除（必要に応じて）**
   ```bash
   cdk destroy
   ```

> 詳細は[公式ドキュメント](https://docs.aws.amazon.com/cdk/latest/guide/home.html)も参照してください。
