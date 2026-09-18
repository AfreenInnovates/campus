# CampusEvac

A two-player, real-time evacuation drill that runs in the browser.

- The **evacuee** walks through a smoky campus building in first person and has to reach the
  outdoor assembly point.
- The **warden** watches the same building from above, verifies evidence, sends route guidance
  and triggers one intervention (ventilation).
- Neither player can win alone. Everything they do is synced live over **AWS AppSync Events**,
  and every lobby action and command is recorded in **Amazon DynamoDB**.