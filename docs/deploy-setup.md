# Deploy setup (one time)

These steps connect GitHub to AWS so that merges deploy automatically.
Until they are done, the Deploy workflow skips itself and nothing breaks.

All AWS steps use the **eu-central-1 (Frankfurt)** region.

## 1. Protect against surprise costs

In the AWS console, open **Billing → Budgets → Create budget**, choose the
zero-spend or monthly cost template, set it to **$1**, and add your email.

## 2. Create the deploy role

1. Open **CloudFormation → Create stack → With new resources**.
2. Choose **Upload a template file** and pick `infra/github-deploy-role.yaml` from this repo.
3. Name the stack `odormap-github-deploy` and click **Next**.
4. On **Configure stack options**, scroll to the bottom. Under **Capabilities**, tick
   "I acknowledge that AWS CloudFormation might create IAM resources with custom names".
   Then click **Next** and **Submit**. (Without it the stack fails with
   "Requires capabilities: [CAPABILITY_NAMED_IAM]"; delete it and start again.)
5. When it finishes, open the stack's **Outputs** tab and copy `DeployRoleArn`.

## 3. Get a Google sign-in client id

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. **Create credentials → OAuth client ID → Web application**.
3. Under **Authorized JavaScript origins**, add the web app's addresses
   (for example `http://localhost:5173` and the Vercel address).
4. Copy the **Client ID**.

## 4. Tell GitHub the settings

In this repository, open **Settings → Secrets and variables → Actions**:

- **Variables tab → New repository variable:** `AWS_DEPLOY_ROLE_ARN` = the ARN from step 2.

Then open **Settings → Environments** and create two environments, `staging` and `production`.
In each one add:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `JWT_SECRET` | Long random text, different per environment. Generate with `openssl rand -base64 48` |
| Variable | `GOOGLE_CLIENT_ID` | The client id from step 3 |
| Variable | `ALLOWED_ORIGINS` | The web app address(es), comma separated, e.g. `https://odormap.vercel.app` |

## 5. Deploy

- **Staging:** merge any pull request into main, or run **Actions → Deploy → Run workflow → staging**.
- **Production:** push a version tag (`git tag v0.1.0 && git push --tags`), or run the workflow and choose production.

The API address is printed at the end of the `sam deploy` step as `ApiUrl`.
Check it works by opening `<ApiUrl>health`; it should answer `{"ok":true}`.
