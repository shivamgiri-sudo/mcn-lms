## Purpose

Describe the problem, the intended outcome and why this change is necessary.

## Change scope

- [ ] Backend/API
- [ ] Frontend/UI
- [ ] Database migration
- [ ] Security/authorization
- [ ] Release/infrastructure
- [ ] Documentation only

## Risk and data impact

- User roles and scopes affected:
- Tables, migrations or data transformations:
- External integrations affected:
- Feature flag or kill switch:
- Backward compatibility:
- Rollback approach:

## Validation evidence

- [ ] Relevant unit/regression tests pass
- [ ] Frontend production build passes
- [ ] Prisma schema validates
- [ ] Clean migration rehearsal passes
- [ ] Upgrade rehearsal preserves existing data
- [ ] Authorization/branch-scope tests pass
- [ ] Dependency and production audits pass
- [ ] Container or deployment smoke test passes when applicable
- [ ] Backup/restore proof is attached when applicable

List exact commands, workflow runs and evidence artifacts:

## Security review

- [ ] No secret, password, token, production hostname or personal data is committed
- [ ] Server-side authorization is enforced for every changed protected action
- [ ] Logs and errors do not expose sensitive values
- [ ] Upload, export and public-verification surfaces were reviewed
- [ ] New dependencies are justified and reviewed

## Release decision

- [ ] No deployment is included
- [ ] Safe for controlled rollout
- [ ] Requires production environment approval
- [ ] Requires credential rotation
- [ ] Requires incident/change record

## Reviewer notes

Call out any area that must be reviewed by Security, Database, Operations, Training & Quality or Release Management.
