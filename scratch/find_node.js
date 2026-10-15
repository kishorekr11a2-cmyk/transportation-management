const { execSync } = require('child_process');
try {
  const out = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine').toString();
  console.log(out);
} catch (e) {
  console.error(e);
}
