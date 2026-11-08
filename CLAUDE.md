# Working in this repository

## Commits

Always commit as the repository owner:

```
Karthik Janardhan <karthikjanardhan5@gmail.com>
```

Always commit with `TZ=Asia/Kolkata`:

```bash
TZ=Asia/Kolkata git -c user.name='Karthik Janardhan' \
  -c user.email='karthikjanardhan5@gmail.com' commit -m "..."
```

GitHub files a commit on the contribution calendar by the UTC offset written
into the commit itself, not by the viewer's timezone. Cloud containers run on
UTC, so a commit made at 05:00 IST is stamped `+00:00` and recorded as the
*previous* day — on 2026-11-07 two commits made at 05:00 and 05:02 IST were
filed under Nov 6, leaving Nov 7 blank on a day that had work in it. Anything
authored between 00:00 and 05:29 IST lands on the wrong day without this.

Work on `main` only. The owner keeps a single branch and merges nothing.
