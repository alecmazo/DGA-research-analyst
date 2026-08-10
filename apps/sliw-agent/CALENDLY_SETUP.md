# Calendly setup (Edyta wedding discovery)

I **cannot** create this inside Calendly without your login. You do the UI once (~8 minutes).  
Then paste the **scheduling link** here and I’ll set Railway + verify the site.

---

## You do this in Calendly (manual)

### A. Account

1. Open [https://calendly.com/login](https://calendly.com/login)  
2. Prefer **Edyta’s Google/email** (not a random personal account) so clients see the right host name.  
3. Free plan is enough for Option A.

### B. Create the event type

1. **Event types** → **+ New Event Type** → **One-on-One**  
2. Settings:

| Setting | Use this |
|---------|----------|
| **Event name** | `Wedding dance discovery (15 min)` |
| **Duration** | **15 min** |
| **Location** | **Phone call** (or Zoom if she prefers) — put “Edyta will call the number on your form” in the description if Phone |
| **Description** | See copy below |
| **Date range** | Invitees can schedule **60 days** into the future |
| **Minimum notice** | **4 hours** (or 12 if she wants more buffer) |
| **Buffers** | **10 min after** each call |
| **Max per day** | 4–6 (so she isn’t overbooked) |
| **Availability** | Match real studio hours (e.g. Tue–Sat 10am–6pm Pacific) |

**Description paste:**

```text
15-minute discovery call about your first dance with Edyta Śliwińska (Dancing with the Stars pro).

Bay Area · San Rafael studio · no experience required.

After you book, please also submit the form on our wedding page so we have your email, wedding date, and package interest in our desk:
https://weddings.edytasliwinska.com/#book
```

3. Click **Save / Create**.  
4. Open the event → **Copy link**  
   It looks like:
   ```text
   https://calendly.com/YOUR-USERNAME/wedding-dance-discovery
   ```
   or  
   ```text
   https://calendly.com/d/xxxx/wedding-dance-discovery
   ```

### C. Send me that link

Reply in chat with **only** the URL (or put it in Railway yourself — see below).

---

## I do this (or you can)

Once you have the link, either:

**Option 1 — tell me the URL** and I’ll run:

```bash
railway variable set SLIW_WEDDING_CALENDLY_URL='https://calendly.com/...' --service web
```

**Option 2 — you set it** in Railway Dashboard:

1. [railway.com](https://railway.com) → project **upbeat-ambition** → service **web**  
2. **Variables** → **New**  
3. Name: `SLIW_WEDDING_CALENDLY_URL`  
4. Value: your Calendly link  
5. Save (redeploy if Railway doesn’t auto-redeploy)

### Verify

```bash
curl -s https://weddings.edytasliwinska.com/api/sliw/public/wedding-config | grep calendly
```

You should see `"calendly_url":"https://calendly.com/..."`.

On the site, **Book** section should show **Open calendar** + an embed.

---

## Optional later (not required for Option A)

| Item | Why |
|------|-----|
| Personal Access Token | Only if we automate “create single-use links” via API |
| Zapier/Make | Calendly booked → email Edyta (nice-to-have; form already hits Sliw) |
| Custom questions on Calendly | Wedding date, partner names — form already captures these |

**Do not** put a Calendly PAT in git. Railway env only if we add API automation later.
