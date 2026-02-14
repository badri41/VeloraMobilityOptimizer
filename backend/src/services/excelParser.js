const { runProcess } = require('../utils/processRunner');
const path = require('path');

const PARSER_SCRIPT = path.join(__dirname, '../../../parser/excel_to_json.py');
const TIMEOUT_MS = 30 * 1000; // 30 seconds

async function parse(inputExcel, outputJson) {
  console.log(`Parsing Excel: ${inputExcel} -> ${outputJson}`);

  const result = await runProcess('python3', [PARSER_SCRIPT, inputExcel, outputJson], {
    timeout: TIMEOUT_MS,
    cwd: path.join(__dirname, '../../..')
  });

  if (result.exitCode !== 0) {
    throw new Error(`Excel parser failed: ${result.stderr}`);
  }

  console.log('Excel parsing completed');
  return result;
}

module.exports = { parse };
