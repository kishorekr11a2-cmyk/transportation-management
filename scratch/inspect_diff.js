const { execSync } = require('child_process');
const diff = execSync('git diff -U2 backend/services/aiAgentService.js').toString();
const hunks = diff.split(/^@@ /m).slice(1);
console.log('Total hunks in aiAgentService.js:', hunks.length);
hunks.forEach((h, idx) => {
    const lines = h.split('\n');
    const header = lines[0];
    const preview = lines.slice(1, 12).join('\n');
    console.log(`\n=== Hunk ${idx + 1}: @@ ${header} ===\n${preview}`);
});
