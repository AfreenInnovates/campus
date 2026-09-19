# Deploying the drill report

The report endpoints run in the Amplify SSR compute (`WEB_COMPUTE`), not in the browser, so
they need runtime credentials and configuration that the build does not provide.

## 1. Runtime permissions

`app/api/report/*` calls SES and DynamoDB. The compute role starts with only Polly and
`dynamodb:Query`, so the report routes return 502 until this is applied:

```bash
aws iam put-role-policy \
  --role-name CampusEvacAmplifyComputeRole \
  --policy-name CampusEvacRuntimeAccess \
  --policy-document file://infra/amplify-compute-policy.json \
  --region ap-south-1
```

This replaces the inline policy wholesale, so the file must keep the existing Polly and
`dynamodb:Query` statements alongside the new ones.

## 2. Runtime configuration

`REPORT_FROM_EMAIL` must be an SES-verified identity in `SES_REGION`, and it must match the
identity named in the `SendDrillReports` statement above.

```bash
aws amplify update-app --app-id d3skpx6qxc85hh --region ap-south-1 \
  --environment-variables \
    EVENTS_REGION=ap-south-1,\
POLLY_REGION=ap-south-1,\
SES_REGION=ap-south-1,\
REPORTS_TABLE=campusevac-events,\
REPORT_FROM_EMAIL=verified-sender@example.com,\
NEXT_PUBLIC_EVENTS_API_KEY=<existing-appsync-api-key>,\
NEXT_PUBLIC_EVENTS_HTTP_HOST=d5dibafzs5dnrhfg36iojcnnsq.appsync-api.ap-south-1.amazonaws.com,\
NEXT_PUBLIC_EVENTS_REALTIME_URL=wss://d5dibafzs5dnrhfg36iojcnnsq.appsync-realtime-api.ap-south-1.amazonaws.com/event/realtime
```

`update-app` replaces the whole map, so every existing variable is repeated above. Dropping
one silently breaks the realtime lobby at the next build.

A redeploy is required afterwards: `NEXT_PUBLIC_*` values are inlined at build time.

## 3. Sandbox behaviour

Until SES production access is granted, an unverified recipient is sent a confirmation link
and their report is held in DynamoDB (`report#<email>` / `pending`, 24h TTL). The end card
polls `/api/report/status` and delivers the moment the link is clicked. Once production
access is granted, `identityState` reports every address as sendable and the hold path stops
being used on its own - no code change needed.
