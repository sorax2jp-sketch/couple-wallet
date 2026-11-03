# ふたりの立替 / couple-wallet

夫婦2人の50:50立替精算PWA。**Firebase Sparkの無料枠で運用する構成**です。フロントはVite / React / TypeScript、配信はVercel Hobby。Firebase Authentication（メール/パスワード）、Cloud Firestore、Security Rules、App Check（reCAPTCHA Enterprise）を使用します。

Cloud Functions、Firebase App Hosting、Cloud Run、本番用Admin SDK、Vercel Functionsは使用しません。課金設定変更・本番デプロイは実行していません。

## なぜ以前はBlazeが必要だったか

旧実装の `functions/src/index.ts` が `firebase-functions/v2/https` のCallable Function `wallet` を定義し、Admin SDKで招待・家計作成・立替更新・精算を処理していました。`src/firebase.ts` が `httpsCallable` で呼び出し、`firebase.json` と旧 `deploy:backend` がFunctionsのデプロイを指定していました。Cloud Functionsの本番利用がBlazeを必要とした直接の理由です。App Hostingや独自のCloud Runを採用していたわけではありません。Admin SDKというライブラリ自体が必ず有料なのではなく、その実行基盤がFunctionsでした。

これらを削除し、`src/wallet.ts` のWeb SDKトランザクションと `firestore.rules` の検証へ置き換えました。Sparkへの移行時はApp CheckをreCAPTCHA v3にしていましたが、新規Web向けの構成に合わせて現在は `ReCaptchaEnterpriseProvider` へ変更しています。Blazeが必要だった原因はCloud Functionsであり、Enterpriseプロバイダーを使うWeb SDK自体ではありません。

## Sparkでの本番運用条件

構成上、Blazeへのアップグレードや課金アカウントの登録は不要です。ただし**無制限の無料運用を保証するものではありません**。Firestoreの無料枠、Authenticationの制限、reCAPTCHAプロバイダーの無料枠、Vercel Hobbyの個人・非商用条件内で使います。枠を超えると処理が制限・停止し得ます。自動的にBlazeへ変更するコードはありません。

Firestoreは無料枠対象のデータベースを1つ使用します。全履歴の購読とRulesの参照読み取りも使用量に算入されます。TTL削除、PITR、有料バックアップ等の課金前提のオプションは使いません。履歴が大きくなった場合は購読範囲の見直しが必要です。App CheckはAuthとRulesの代替ではありません。

公式の確認先（プラン・枠・提供条件は変更されることがあります）：

- https://firebase.google.com/pricing
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://cloud.google.com/recaptcha/docs/billing-information
- https://firebase.google.com/docs/rules/manage-deploy#deploy_your_rules

本作業環境から上記公式ページは通信制限で取得できなかったため、その場での最新料金表の再取得はできていません。数値枠を固定した料金保証はしていません。

### Enterpriseの無料枠・Blaze・2人利用の見積もり

reCAPTCHA Enterpriseには公表仕様として **月10,000評価（assessments）の無料枠**があり、無料枠内では課金アカウントをリンクせずに利用する構成を取れます。**Google Cloudの請求先を同じFirebaseプロジェクトへリンクするとBlazeへ切り替わるため、Spark維持のためリンクしません。** 超過分の有料利用はこの構成の対象外です。課金未接続で無料枠や割当を超えると、App Checkトークンを取得できず操作が止まる可能性があります。枠を超えても必ず無料で継続できるわけではありません。

評価回数はFirestoreの読み書き件数そのものではありません。SDKがEnterpriseでApp Checkトークンを取得/更新する際などに発生し、有効トークンを再利用して複数のFirestore操作を行えます。コードは自動更新を有効にし、操作ごとの強制トークン再取得は行いません。

TTLを1時間、1端末につき約30分に1回取得する保守的な概算では、**2端末×48回/日×30日＝約2,880評価/月**です。これは24時間継続利用を仮定した目安なので、夫婦2人の通常利用では無料枠内が現実的です。ただし保証ではなく、ブラウザとPWAの併用、複数タブ、再読み込み、キャッシュ利用可否、再試行、同じプロジェクトの他のEnterpriseキー、不正トラフィック等で増えます。実際のSDK更新タイミングは厳密な30分固定ではありません。Consoleで使用量を監視してください。

**確認の限界：** 今回、公式のEnterprise設定ページ・料金ページへの取得は環境の通信制限（403）で失敗しています。上記は公表仕様を基にした構成・見積もりであり、最新の料金表をこの作業で再取得して確認できたという意味ではありません。公式確認先への通信許可は環境設定の下書きへ追加済みで、まだ実行環境へ反映・公開していません。本番設定前に上記公式リンクで無料枠・請求先なしの利用条件が引き続き有効なことを確認してください。課金を求められる場合は設定を進めません。

## 本番導入：Firebase Consoleで行うクリック手順

以下は**ユーザーが実施するための手順**です。Codexは本番プロジェクトへの設定・デプロイを行っていません。画面名は日本語/英語で併記していますが、Consoleの表示言語や更新で配置が変わることがあります。旧版からの移行は次の「旧版データがある場合」を先に確認してください。

### 1. SparkプロジェクトとWebアプリを登録

1. [Firebase Console](https://console.firebase.google.com/)を開き、Googleアカウントでログイン →「プロジェクトを追加 / Add project」。新規の本番用プロジェクトを作ります。Google Analyticsはこのアプリには不要なので無効で構いません。
2. 左下などの料金プラン表示が **Spark** であることを確認します。Blazeへの変更、課金アカウントのリンクは行いません。
3. プロジェクト概要の歯車 →「プロジェクトの設定 / Project settings」→「全般 / General」→「マイアプリ / Your apps」→ Webの **`</>`** アイコン。
4. アプリのニックネーム（例：couple-wallet）を入力。「Firebase Hostingも設定」は選択せず「アプリを登録」。ホスティングはVercelを使います。
5. 表示される `firebaseConfig` から `apiKey`、`authDomain`、`projectId`、`appId` を控えます。後述のVercel環境変数で使います。`measurementId` や `messagingSenderId` は現在の実装では不要です。

### 2. Authenticationのメール/パスワードを有効化

1. 左メニュー「構築 / Build」→「Authentication」→ 初回は「始める / Get started」。
2. 「ログイン方法 / Sign-in method」→「新しいプロバイダを追加 / Add new provider」→「メール/パスワード / Email/Password」。
3. 「メール/パスワード」を有効にして保存。「メールリンク（パスワードなし）」は使いません。
4. 「設定 / Settings」→「承認済みドメイン / Authorized domains」を開きます。後で確定するVercelの本番ホスト名（例：`your-app.vercel.app`）を「ドメインを追加」で登録します。`https://`やパスは入れません。毎回変わるPreview URLを無制限に追加する必要はありません。
5. パスワード再設定メールは「テンプレート / Templates」→「パスワードの再設定 / Password reset」で送信元・言語・アクションURLを確認します。独自の再設定画面は不要で、Firebaseの標準画面を使用できます。

### 3. 夫婦2人のユーザーを作る

1. Authentication →「ユーザー / Users」→「ユーザーを追加 / Add user」。
2. 1人目の実際のメールアドレスと固有の強い初期パスワードを入力して追加します。ローカルデモのメール/パスワードは本番に使いません。
3. 同じ操作で2人目を追加します。初期パスワードはそれぞれ安全に受け取り、ログイン画面の「パスワードを再設定」で各自のものに変更します。READMEやGit、チャットへ記録しません。
4. Users一覧から各ユーザーの **UID（ユーザーUID）** をコピーします。以下では1人目を `UID_A`、2人目を `UID_B` と表記します。メールアドレスではありません。同じUIDを2回登録しないでください。
5. アプリに新規登録画面はありませんが、これだけでFirebase Authの登録API自体が閉じるわけではありません。仮に他人がAuthアカウントを作っても、次の固定メンバー登録とRulesにより家計にはアクセスできません。

### 4. Firestoreを作り、初期の3ドキュメントを登録

1. 「構築 / Build」→「Firestore Database」→「データベースの作成 / Create database」。
2. エディション選択が出る場合は **Standard / ネイティブモード** を使用します。無料枠対象の `(default)` データベースを1つ作ります。追加データベースや有料オプションは不要です。
3. ロケーションを選択（日本で使う場合の例：`asia-northeast1` 東京）。場所は後から簡単に変更できないため、作成前に確認します。
4. 「本番環境モード / Production mode」で開始します。**テストモードや `allow read, write: if true` は使いません。** この時点ではアプリから読めなくても正常です。Consoleの管理者操作でデータを登録できます。
5. 「データ / Data」→「コレクションを開始 / Start collection」。コレクションIDを **`households`**、ドキュメントIDを **`couple`**（任意の固定IDでも可）にして以下のフィールドを登録します。

| フィールド名        | 型     | 設定値                                                                            |
| ------------------- | ------ | --------------------------------------------------------------------------------- |
| `memberUids`        | array  | stringの要素を2つ：実際の`UID_A`、実際の`UID_B`                                   |
| `names`             | map    | キーを実際の`UID_A`、値をstringの`みーみ`。もう1つ実際の`UID_B`、stringの`たくと` |
| `currentCycleId`    | string | `initial`                                                                         |
| `currentPaidTotals` | map    | キーを実際の`UID_A`、値をnumberの`0`。もう1つ実際の`UID_B`、numberの`0`           |
| `revision`          | number | `0`（整数）                                                                       |
| `mutation`          | map    | `kind`をstringの`init`、`id`をstringの`initial`                                   |

arrayは「要素を追加」で2要素を作り、それぞれstringを選びます。mapは展開して子フィールドを追加します。`UID_A`という文字列をそのまま入力せず、Authでコピーした実UIDを**キー**にも使ってください。`0`をstringで保存しないでください。

登録後のデータの形は次のとおりです（Consoleのフォームに1フィールドずつ入力します）。

```json
{
  "memberUids": ["UID_A", "UID_B"],
  "names": { "UID_A": "みーみ", "UID_B": "たくと" },
  "currentCycleId": "initial",
  "currentPaidTotals": { "UID_A": 0, "UID_B": 0 },
  "revision": 0,
  "mutation": { "kind": "init", "id": "initial" }
}
```

6. 保存したらFirestoreのルートへ戻り、「コレクションを開始」で **`users`** を作成します。ドキュメントIDは1人目の実UID、フィールドは **`householdId` / string / `couple`**（上で決めた家計ID）だけを登録します。
7. `users` コレクションの「ドキュメントを追加」で、2人目の実UIDをドキュメントIDにして同じ `householdId` を登録します。
8. 次の3パスがあることを確認します。`expenses` と `settlements` はアプリが作成するので手動作成不要です。

```text
households/couple
users/実際のUID_A  → householdId: "couple"
users/実際のUID_B  → householdId: "couple"
```

この固定登録が招待・連携の代替です。クライアントにはhousehold作成、user対応表作成、memberUids変更の権限を与えません。Console管理者はRulesを迂回できるため、運用開始後に残高・cycle・精算記録を手動で書き換えないでください。

### 5. Security Rulesを反映し、Indexesを確認

1. Firestore Database →「ルール / Rules」。エディタの内容を、リポジトリの **[firestore.rules](firestore.rules) 全文**で置き換えます。READMEの一部やサンプルの許可ルールを貼るのではありません。
2. プロジェクトIDが本番の対象であることを確認 →「公開 / Publish」。エラーが出たら解消するまでアプリを公開しません。この手順はユーザーが本番反映するときだけ実行します。
3. 「インデックス / Indexes」→「複合 / Composite」。**現状、追加の複合インデックスは0件**です。`firestore.indexes.json` の `indexes` は空です。
4. 「単一フィールド / Single field」で自動インデックスを使用します。アプリのサーバークエリは現在cycleの `cycleId == ...` のみで、`cycleId`の自動インデックスがあれば動きます。`cycleId`のインデックス除外を追加しないでください。履歴検索と並び替えはクライアント側のため追加indexは不要です。
5. 以前設定したindex除外がある場合は確認します。必要なindexを推測して追加したり、エラーを避けるためRulesを緩めたりしません。

CLIでRules/indexを管理したい場合だけ、正しいプロジェクトを指定して次を実行できます。本作業では未実行です。

```sh
npx firebase deploy --project YOUR_PROJECT_ID --only firestore:rules,firestore:indexes
```

### 6. App CheckとreCAPTCHA Enterprise

この実装は Firebase Web SDK の **`ReCaptchaEnterpriseProvider`** を使います。従来のreCAPTCHA v3キーではなく、同じGoogle Cloud/Firebaseプロジェクトの **Webサイト用・スコアベースのEnterpriseサイトキー** を登録します。Enterpriseの採用自体を理由にBlazeへ変更する必要はありません。無料枠と最新の提供条件の確認状態は上の「Enterpriseの無料枠」を参照してください。

1. [Google Cloud Console](https://console.cloud.google.com/)を開き、上部のプロジェクト選択で **Firebaseと同じプロジェクトID** を選びます。別プロジェクトのキーを混ぜないでください。
2. メニューまたは上部検索で「reCAPTCHA」を開きます。reCAPTCHA Enterprise APIの有効化を求められたら対象プロジェクトで有効化します。**Cloud Billingのリンク、請求先の登録、Blazeへの変更は行いません。** 無料利用では進めない表示が出た場合は、その時点で最新の公式条件を確認し、課金の手続きを進めないでください。
3. 「キーを作成 / Create key」で表示名を入力し、プラットフォームに **ウェブサイト / Website** を選びます。**スコアベース**（チェックボックスチャレンジなし）のキーにします。v2のチェックボックス、従来v3のキー、WAF連携用の別キーは使いません。
4. ドメイン設定に本番Vercelホスト名（例：`your-app.vercel.app`）、独自ドメインを使う場合はそのホスト名も登録します。`https://`やパスは不要です。ドメイン検証は有効にし、本番キーをテスト専用キーに設定しません。ローカル開発はEmulatorを使います。
5. 作成された **サイトキー / Key ID（公開）** を控えます。VercelとFirebase App Checkに同じキーを指定します。このEnterprise連携では旧v3のシークレットキーやサービスアカウント秘密鍵を作成・ダウンロードしてアプリへ渡す必要はありません。
6. Firebase Console →「App Check」→ 初回は「始める / Get started」。対象Webアプリを「登録 / Register」→ **reCAPTCHA Enterprise** を選択し、サイトキー / Key IDを登録します。既存v3設定を使っていた場合は対象アプリのプロバイダー設定をEnterpriseへ変更します。トークンTTLはまず **1時間**、リスクスコア閾値は既定値を使います。短いTTLはトークン更新・評価回数を増やすため、無料枠の検証前に不用意に短縮しません。
7. VercelのProduction変数へ **`VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`** を追加します。旧 `VITE_RECAPTCHA_V3_SITE_KEY` は削除します。値の名前変更だけでは不十分で、**値自体もEnterpriseのキー**に置き換えます。新規ビルドが必要です。
8. ユーザーが公開を決定したとき、初回はFirestore強制適用前の導入確認として、2台からログイン・読み取り・登録を試し、App Checkの指標で有効なリクエストを確認します。その後 App Check →「API / APIs」→ **Cloud Firestore** →「強制 / Enforce」を有効にし、反映を待って両端末・PWAで登録・編集・精算を再確認します。**SDKの初期化だけでは強制適用は有効になりません。強制適用後の確認まで完了してから日常利用を開始します。**
9. 既存の本番でApp Check強制適用済みの場合は、先に別の検証環境でキー・プロバイダー変更を確認します。プロバイダー設定とフロントのキーが不一致の間、トークン取得やFirestoreが拒否される可能性があります。エラー回避のために本番のRulesやApp Checkを恒久的に緩めません。このアプリの本番公開はまだ実施していません。
10. Google CloudのreCAPTCHA使用量・評価回数と、Firebase App Checkの有効/無効リクエストを確認します。課金未接続でも使用量の監視は必要です。無料枠を超えない運用にし、超過時に請求先を自動リンクする仕組みは作りません。
11. AuthenticationのApp Check保護はConsoleの提供条件を確認して対応可能な範囲で設定します。Auth側のオプションのためにBlazeへ変更することはしません。Firestoreの強制適用、Authによる本人確認、Rulesによる所属確認は必須です。
12. App Checkのデバッグトークンや `FIREBASE_APPCHECK_DEBUG_TOKEN` を本番へ入れません。Emulatorでだけ省略し、本番ビルドではEmulator環境変数をtrueにしても省略されません。

Vercelの本番ドメインが未確定なら、Vercelのプロジェクト設定で予定ホスト名を確認してからAuthとEnterpriseキーへ登録します。画面名はConsoleの更新で変わる場合があります。公式のEnterprise設定手順とキーの種類が一致していることを確認してください。

### 7. Vercelの設定と環境変数（ユーザーが公開を決めたとき）

1. [Vercel Dashboard](https://vercel.com/dashboard) →「Add New…」→「Project」→ GitHubの `couple-wallet` リポジトリを選びます。
2. Root Directoryは `package.json` があるディレクトリです（リポジトリ直下なら既定値）。Framework Presetは **Vite**、Build Commandは **`npm run build`**、Output Directoryは **`dist`**。個人・非商用のHobbyを使います。
3. 初回Importの「Environment Variables」、またはプロジェクト →「Settings」→「Environment Variables」で次を登録します。対象は **Production**。Previewにも使う場合は別の開発用Firebaseプロジェクトを推奨し、本番データへ接続しない運用にします。

| Vercelの変数名                       | コピー元・値                                | 公開区分   |
| ------------------------------------ | ------------------------------------------- | ---------- |
| `VITE_FIREBASE_API_KEY`              | FirebaseのWeb設定 `apiKey`                  | 公開識別子 |
| `VITE_FIREBASE_AUTH_DOMAIN`          | `authDomain`                                | 公開識別子 |
| `VITE_FIREBASE_PROJECT_ID`           | `projectId`                                 | 公開識別子 |
| `VITE_FIREBASE_APP_ID`               | `appId`                                     | 公開識別子 |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | スコアベースEnterpriseのサイトキー / Key ID | 公開キー   |
| `VITE_USE_EMULATORS`                 | `false`、または変数を作らない               | 開発設定   |

値は引用符で囲まず、前後に空白を入れません。`VITE_*`はビルドされたJavaScriptに埋め込まれ、利用者から見えます。Vercelで「Sensitive」にしてもブラウザから秘密にはなりません。

4. Authの承認済みドメインとreCAPTCHAの許可ドメインに、本番ホスト名があることを再確認します。
5. **ユーザーが公開を決定した後だけ**「Deploy」。環境変数を後から変更した場合は「Deployments」→対象デプロイのメニュー→「Redeploy」で新しくビルドします。変更するだけでは既存のビルドへ反映されません。
6. HTTPSの本番URLで下の実機チェックリストを実施します。Cloud Functions、Vercel Functions、Firebase Hostingの設定は不要です。

## 環境変数と秘密情報をGitへ入れないための確認

- `.env.example` は空の公開設定項目と `VITE_USE_EMULATORS=false` のみです。コピーして使う `.env.local`、`.env.production` 等は `.gitignore` の `.env*` で除外し、`.env.example` だけ例外にしています。
- Firebase WebのAPIキーは公開識別子です。秘密に隠すことで家計を守る方式ではなく、Auth・Rules・App Checkで保護します。用途に合うAPI/アプリ制限はプロジェクト設定に合わせて確認してください。
- **旧v3シークレットキー、パスワード、サービスアカウントJSON/秘密鍵、Firebase/Vercel CLIトークンをGitへ入れません。** Enterprise用にアプリへ渡す値は公開サイトキーだけです。 本構成ではサービスアカウントの作成・ダウンロード自体が不要です。
- `.vercel/`、秘密鍵拡張子、典型的なサービスアカウントJSON名も除外しています。ただしGitignoreは漏えい検査や秘密管理サービスではありません。任意の別名ファイルや `git add -f` では追加できるため、コミット前に差分とファイル一覧を確認します。一度コミットした秘密はignore追加で消えません。漏えいした場合は失効・再発行し、履歴の対処も行います。

確認コマンド（値を表示する必要はありません）：

```sh
git check-ignore .env.local .env.production .vercel/project.json credentials.pem
# 上のパスが表示されること
# .env.example は除外されず、共有できること
git status --short
git diff --cached --name-only
```

### 旧版データがある場合

本作業では本番データへ接続も変更もしていません。旧版の立替には `deleted: false` の追加が必要です。家計には2人の正しい固定UID・user対応表と整数revisionが必要です。新しいmutationは最初の更新で設定されます。精算記録と金額をそのまま保持し、Consoleでバックアップを確保した上で個別移行してください。初期化用サンプルで既存家計の残高を上書きしないでください。旧Functionsをすでにデプロイ済みなら、新Rulesの公開だけではAdmin SDKの権限は止まらないため、旧エンドポイントの停止も移行時に必要です。

## 開発・検証

Node.js 22以上、npm、Emulator用Java 21以上。既存チェックアウトを使用し、worktreeは不要です。

```sh
cd /workspace/couple-wallet
npm ci
npm test
npm run build
npm run test:rules
```

`test:rules`は実Firestore EmulatorでWeb SDKトランザクションとRulesをまとめて検証します。`test:integration`も同じ検証の別名です。外部Firebaseプロジェクトには接続しません。

### アプリをローカルで実際に触る

ターミナル1:

```sh
npm run emulators
```

ターミナル2（エミュレーター起動後）:

```sh
node scripts/seed-emulator.mjs
VITE_USE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-couple-wallet npm run dev
```

ローカル専用の `miimi@example.test` / `takuto@example.test`、共通パスワード `local-demo-only` で別ブラウザセッションからログインできます。seedは127.0.0.1のエミュレーターのみ接続し、本番資格情報・Admin SDKを使用しません。同じ家計があれば残高や明細を初期化しません。停止後のデータは永続化しません。

本番の値をローカルファイルへ保存する必要はありません。ローカルエミュレーターだけApp Checkを省略します。本番ビルドではエミュレーター接続は無効です。Firestore Emulator初回取得には `storage.googleapis.com` の許可が必要です。

## アクセス制御と整合性

- 全てデフォルト拒否。認証済みの固定2人だけが家計・明細・精算を読み取れます。自分以外のuser対応表は読めません。家計・対応表・招待の作成やメンバー変更はクライアントから一切できません。
- 1トランザクションにつき1明細の追加・編集・削除と家計合計を更新。Rulesの `getAfter` で対象明細と両メンバーの増減を検証します。合計だけ変更、明細だけ変更、複数明細を紛れ込ませる書き込みは拒否します。
- 削除は `deleted: true` の論理削除。合計から除外し、画面・検索・精算対象に出しません。整合性検証のため内部レコードを保持します。物理削除、復活、削除済みの再編集は拒否します。
- 精算は実支払差額の絶対値÷2を切り捨て、送金方向・支払合計スナップショット・サーバー時刻もRulesで照合。精算作成と次cycle・合計0への変更を同一トランザクションで強制し、閉じたcycleの再利用も拒否します。
- 精算済みの編集・削除はRulesで拒否。差額調整は現在cycleの新規明細で対応します。過去日付の立替も現在cycleに登録されます。
- 精算確認は前後の家計revisionが一致するサーバー読み取りで構成。確定時にもrevision/cycleを比較して変更があれば再確認を要求します。通常の同時追加はトランザクションで直列化。Rulesが先行更新を検出した場合、revisionが変わったことを確認できた操作だけ最大5回の範囲で再試行します。
- 表示名変更は自分のフィールドのみ。金額・文字列・日付・createdBy・更新時刻をRulesでも検証します。ブラウザの入力チェックを迂回しても保護されます。

全履歴を取得してローカル検索します。精算cycleで区切り、cycle内は立替日順。前回登録は件名部分一致のcreatedAt最新1件。PWAはmanifest・独自アイコン・Service Workerを含み、API取引はキャッシュしません。オフライン更新は不可、サーバー成功前に成功表示は出しません。任意仕様の簡易電卓・短時間取り消しは未実装です。

公開環境でのAuth / App Check接続、Vercel公開、iPhone / Android実機確認は未実施です。ローカル検証の成功は本番公開済みを意味しません。

## 今回の変更で確認した結果

- 計算・検索・画面操作20件とApp Check設定4件の計24テスト成功。
- 実Firestore EmulatorでRules・Web SDKの27テスト成功（未認証/他人の拒否、改ざん、集計の原子性、精算済み保護、同時操作を含む）。
- Auth / Firestore Emulatorとモバイル幅のChromiumの2セッションで、2人のログイン、立替の共有、20,000円の精算、精算後の履歴と編集不可を確認。横はみ出し・ページエラーなし。
- TypeScript / Vite / PWAビルド、フォーマットチェック、差分の空白チェック成功。

料金プランの変更、課金アカウント設定、本番デプロイ、環境の公開はいずれも行っていません。環境のinstall_script / start_skillのみ、新構成へ合わせて下書き保存しています。

## 本番公開後の実機チェックリスト

**iPhoneのSafari/ホーム画面版と、AndroidのChrome/インストール版の両方で実施**します。完了にチェックを付け、端末・OS・ブラウザのバージョンを記録してください。以下はまだ実機で実施していません。精算は送金済みを記録する機能です。確認用の少額データは2人で合意して使い、本物の支出と混同しない件名にします。精算後に削除して戻すことはできません。

### 接続・ログイン・保護

- [ ] HTTPSの正しい本番URLを開き、接続設定エラーが出ない。
- [ ] 各自のアカウントでログインでき、再起動後もログインが保持される。
- [ ] ログアウト後に家計情報が表示されず、ログインが必要になる。
- [ ] パスワード再設定メールが本人のメールアドレスに届き、変更後のパスワードでログインできる。
- [ ] Authの承認済みドメイン、Enterpriseキーの許可ドメインが本番ホストと一致し、Firebase・Google Cloud・App Checkが同一プロジェクトの正しいキーを使う。
- [ ] SparkのままでCloud Billingが未リンク。Enterpriseの評価使用量を確認でき、無料枠内に収まっている。
- [ ] App Checkで有効な本番リクエストを確認でき、Firestoreの強制適用が有効。
- [ ] 強制適用後も**両端末・PWA版**で読み取り・登録・編集・精算に成功する。
- [ ] プロジェクト管理者用の独立したテスト環境で、未認証・別UID・有効なApp Checkなしのアクセスが拒否されることを確認する。本番でルールを緩めて試さない。

### 立替・検索・精算

- [ ] 片方で登録すると、もう片方にも同じ件名・金額・支払者・日付が反映される。
- [ ] 未精算明細の金額・支払者を編集すると、両方の支払合計・精算方向・精算額が更新される。
- [ ] 未精算明細を削除すると、両端末の一覧・合計・検索結果から除外される。
- [ ] 例：支払合計101円対0円なら「未払い側 → 支払った側 50円」と表示される。正負だけの表示にならない。
- [ ] 「電気」などの入力で直近に登録した一致明細が表示される。古い立替日を後から登録しても現在の未精算に入る。
- [ ] 件名・金額・支払った人で検索でき、絞り込み中も精算区切りが残る。
- [ ] 精算確認の明細一覧・件数・方向・金額が正しく、完了後は両端末の残高が0になる。
- [ ] 精算後も明細と精算記録が残り、精算済み明細に編集・削除ボタンがない。
- [ ] 確認画面を開いたまま別端末で立替を追加すると、古い確認内容では精算できず再確認を求められる。
- [ ] 2端末から同時に追加・精算を試しても二重精算や対象不明の立替が生じない。失敗時はエラーが表示される。
- [ ] 機内モード/通信断で登録・編集・精算が成功表示にならず、入力を失わず再試行できる。通信復帰後、二重登録がないことを確認する。

### PWA・モバイル操作

- [ ] iPhone Safari：共有ボタン →「ホーム画面に追加」→ 追加したアイコンから起動。
- [ ] Android Chrome：メニュー →「アプリをインストール」または「ホーム画面に追加」→ アイコンから起動。
- [ ] 独自アイコン・名称が表示され、ホーム画面からstandaloneで起動する。
- [ ] 金額、下部ナビ、＋ボタンが読みやすく、横にはみ出さない。ノッチ・ホームインジケーターにボタンが隠れない。
- [ ] 数字キーボード・日付選択・キーボードを閉じる操作ができ、登録ボタンをタップできる。
- [ ] Safari/Chromeの通常画面とPWAで表示を比較する。OSによって認証状態の共有方法が異なるため、必要ならそれぞれログインする。
- [ ] 新しい版へ更新した後、アプリを閉じて開き直し、古い画面・設定が残っていないか確認する。

## 最終セキュリティ監査の範囲と残る責任

監査結果・攻撃ケースとテストの対応は [docs/security-review.md](docs/security-review.md) を参照してください。正当なメンバーが未精算の金額・支払者を変更することは仕様上許可しますが、集計も同一トランザクションで正しく変更することをRulesで強制します。入力された支出が現実の支払いと一致するかまではシステムで検証できません。

Console/IAM管理者はRulesの対象外です。管理者アカウントの多要素認証と最小限の権限、正しい初期UID登録、実際のRules反映、App Check強制適用が必要です。端末・アカウントの乗っ取り、入力の虚偽、無料枠超過、全履歴取得による将来の使用量増加、削除データの内部保持、公開環境の設定誤りは残るリスクです。Emulatorは本番App Checkや端末固有の挙動を証明しません。継続的な履歴保全の運用も別途決めてください。
