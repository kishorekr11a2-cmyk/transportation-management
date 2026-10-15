const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:\\Users\\R Deepa Rathi\\.gemini\\antigravity-ide\\brain\\d27b722b-b838-4b39-a1ce-d885ef12c760\\.system_generated\\logs\\transcript.jsonl')
});

const edits = [];
rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.tool_calls) {
      obj.tool_calls.forEach(tc => {
        if (tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') {
          edits.push({
            step: obj.step_index,
            file: tc.args.TargetFile ? tc.args.TargetFile.replace(/^"|"$/g, '').replace(/\\/g, '/').toLowerCase() : '',
            rawFile: tc.args.TargetFile ? tc.args.TargetFile.replace(/^"|"$/g, '') : '',
            desc: tc.args.Description,
            instruction: tc.args.Instruction,
            target: tc.args.TargetContent,
            repl: tc.args.ReplacementContent,
            chunks: tc.args.ReplacementChunks
          });
        }
      });
    }
  } catch {}
});

rl.on('close', () => {
  const sessionFiles = [
    'routeoptimizationservice.js',
    'aiagentservice.js',
    'ratelimiter.js',
    'staleplanandresetsafety.test.js',
    'optimizationresultsummary.jsx',
    'planconfirmation.jsx',
    'aiagent.jsx'
  ];

  const relevant = edits.filter(e => e.file && sessionFiles.some(sf => e.file.endsWith(sf)));
  
  const byFile = {};
  relevant.forEach(e => {
    const key = sessionFiles.find(sf => e.file.endsWith(sf));
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push(e);
  });

  fs.writeFileSync('backend/scratch/session_edits_detailed.json', JSON.stringify(byFile, null, 2));
  console.log('Saved detailed edits to backend/scratch/session_edits_detailed.json');
  for (const k of Object.keys(byFile)) {
    console.log(`- ${k}: ${byFile[k].length} edits`);
  }
});
