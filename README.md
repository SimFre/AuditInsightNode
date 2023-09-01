
# Audit Insight Node

I've been tasked to review and user accesses based on data held in Jira Insight.
The Active Directory is scraped and fed into Insight, from which I'm pulling
shared folders, and their respective access groups. Each group is then resolved
into a list of users. The access level is held in the group name (mostly), like ".Modify".

The output is a semi-colon separated string, that I'm passing to Excel for better visibility.

Data is fetched using Jira's API, with a Token held in `.env`.

It is a very specific implementation, but perhaps someone can get som inspiration for their
project. I've simultaneously tried to keep it somewhat environment neutral.

1. Pull the git source
2. npm install
3. Edit .env
4. npm run start

Happy auditing!
