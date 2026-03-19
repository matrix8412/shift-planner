const fs = require('fs');
let code = fs.readFileSync('src/server/actions/records.ts', 'utf8');

// Step 0: Update requireCurrentPermission to return user!.id
code = code.replace(
  'async function requireCurrentPermission(permission: PermissionCode) {\n  await ensurePermissionCatalog();\n  const user = await getCurrentUser();\n  requirePermission(user, permission);\n}',
  'async function requireCurrentPermission(permission: PermissionCode) {\n  await ensurePermissionCatalog();\n  const user = await getCurrentUser();\n  requirePermission(user, permission);\n  return user!.id;\n}'
);

// Step 0b: Update writeAuditLog to accept actorId
code = code.replace(
  `async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  payload: Prisma.InputJsonValue,
  action: "CREATE" | "UPDATE" | "DELETE" = "CREATE",
) {
  await tx.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      payload,
    },
  });
}`,
  `async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  payload: Prisma.InputJsonValue,
  action: "CREATE" | "UPDATE" | "DELETE" = "CREATE",
  actorId?: string,
) {
  await tx.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      payload,
      actorId: actorId ?? null,
    },
  });
}`
);

// Step 1: Replace 'await requireCurrentPermission(' with 'const actorId = await requireCurrentPermission('
code = code.replace(/^(\s+)await requireCurrentPermission\(/gm, '$1const actorId = await requireCurrentPermission(');

// Step 2: Track all writeAuditLog calls and add actorId as the last param
const lines = code.split('\n');
let inAudit = false;
let depth = 0;
let callLines = [];

for (let i = 0; i < lines.length; i++) {
  if (!inAudit && lines[i].includes('writeAuditLog(') && !lines[i].includes('async function writeAuditLog')) {
    inAudit = true;
    depth = 0;
    callLines = [];
  }

  if (inAudit) {
    callLines.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }

    if (depth === 0) {
      // Found end of call
      const fullCall = callLines.join('\n');
      const hasExplicitAction = /"(UPDATE|DELETE)"/.test(fullCall);
      const lastLine = lines[i].trimEnd();
      const indent = lines[i].match(/^(\s*)/)[1];

      if (lastLine.trimStart() === ');') {
        if (hasExplicitAction) {
          // Add actorId line before closing );
          lines[i] = indent + '  actorId,\n' + indent + ');';
        } else {
          // No explicit action - need to add "CREATE" then actorId
          lines[i] = indent + '  "CREATE",\n' + indent + '  actorId,\n' + indent + ');';
        }
      } else if (lastLine.endsWith(');')) {
        // Single-line closing, e.g.: }, "UPDATE"); or });
        if (hasExplicitAction) {
          lines[i] = lines[i].replace(/\);(\s*)$/, ', actorId);$1');
        } else {
          lines[i] = lines[i].replace(/\);(\s*)$/, ', "CREATE", actorId);$1');
        }
      }
      
      inAudit = false;
    }
  }
}

code = lines.join('\n');
fs.writeFileSync('src/server/actions/records.ts', code);
console.log('Done. Replacements applied.');
