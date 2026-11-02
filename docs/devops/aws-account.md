# AWS account: setup and sign-in (DevOps stage 4)

The owner does these steps in the browser, once. Why each choice: ADR 0011 (Free plan, Mumbai) and ADR 0029 (root locked away, IAM user with MFA, no Organizations).

**The repo is public.** The account ID, the sign-in alias or link, the root email and every password stay out of it. Keep them in a password manager.

## Rules that can't be undone

- **One account, in your own name.** The Free plan and its credits are only for new AWS customers. Anyone who has (or had) an account is ineligible (Free Tier FAQ). Using a family member's card as the *payment method* is fine. A second account is not.
- **Don't join or create an AWS Organization**, set up Control Tower, or turn on IAM Identity Center's organization instance. Joining Organizations upgrades a Free plan account to Paid, and an upgrade can't be reversed.
- **The 6-month clock starts at sign-up.** The account closes after 6 months or when the credits run out, whichever comes first (ADR 0011).

## A. Get ready (10 minutes)

1. An email you'll keep for years. A Gmail alias works: `yourname+aws@gmail.com` arrives in your normal inbox.
2. A password manager (Bitwarden is free) for the root password and MFA recovery codes.
3. An authenticator app on your phone, or a passkey.
4. A debit or credit card with online and international payments turned on. AWS charges about ₹2 to check the card and refunds it.

## B. Create the account

5. aws.amazon.com → **Create account**.
6. Choose the **Free plan**, account type **Personal**, support plan **Basic**. Fill in your own details.

## C. Lock the root user

The root user is the email login. It can do anything, including closing the account, and no policy can limit it.

7. Top-right menu → **Security credentials** → assign MFA (passkey or authenticator app).
8. Never create access keys for root. Save its password in the password manager.

## D. Create the everyday admin login

9. Top-right menu → **Account** → *IAM user and role access to Billing information* → **Activate**. Without this, an IAM user can't see the credit balance.
10. **IAM** → **User groups** → create `admins` with the policy `AdministratorAccess`.
11. **IAM** → **Users** → create a user for yourself. Turn on console access with a custom password, and add the user to `admins`.
12. **IAM** → **Dashboard** → create an **account alias**. This gives a short sign-in link; bookmark it.
13. Sign out. Sign in through that link as the new user, then add MFA to this user too (**Security credentials**).
14. From now on, use only this login. Root is only for account-level tasks (closing the account, changing the root email, a few billing settings).

## E. Region and money

15. Console **Settings** → default Region **Asia Pacific (Mumbai) `ap-south-1`**.
16. Console Home:
    - **Cost and Usage widget:** credit balance and days left. AWS also emails as the credits and the 6 months run low.
    - **Explore AWS widget**, filtered to *Earn AWS credits*: the activities that earn up to $100 more. Complete them within 6 months of opening the account. Earned credits expire 12 months after sign-up.
17. Do any activity that only sets something up (for example, a budget or alert) now. **Don't start an activity that launches a server or database yet.** Running ones use credits. Bring the list to the next session, so each one is done at the smallest size and removed straight after.

## F. Report back (next session)

- The plan shown (should be **Free**).
- The credit balance and days left.
- The list of credit-earning activities and which ones are done.

## Not yet

- **No AWS CLI or Terraform** until stage 5. The old broken `aws` in `Python311\Scripts` gets removed then, and how the laptop gets short-lived credentials is decided then (ADR 0029).
- No resources: nothing is created in the account in stage 4 apart from the IAM group, the user and any credit activity that costs nothing.
