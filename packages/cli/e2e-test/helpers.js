/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const childProcess = require('child_process');

const { spawn } = childProcess;

const EXPECTED_LOAD_ERRORS = /ECONNREFUSED|ECONNRESET|did not get to load all resources/;

function spawnPiped(cmd, options) {
  function pipeWithPrefix(stream, prefix = '') {
    return data => {
      const prefixedMsg = data
        .toString('utf8')
        .trimRight()
        .replace(/^/gm, prefix);
      stream.write(`${prefixedMsg}\n`, 'utf8');
    };
  }

  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: 'pipe',
    shell: true,
    ...options,
  });
  child.on('error', handleError);
  child.on('exit', code => {
    if (code) {
      print(`Child '${cmd.join(' ')}' exited with code ${code}`);
      process.exit(code);
    }
  });
  child.stdout.on(
    'data',
    pipeWithPrefix(process.stdout, `[${cmd.join(' ')}].out: `),
  );
  child.stderr.on(
    'data',
    pipeWithPrefix(process.stderr, `[${cmd.join(' ')}].err: `),
  );

  return child;
}

function handleError(err) {
  process.stdout.write(`${err.name}: ${err.stack || err.message}\n`);
  if (typeof err.code === 'number') {
    process.exit(err.code);
  } else {
    process.exit(1);
  }
}

function waitFor(fn) {
  return new Promise(resolve => {
    const handle = setInterval(() => {
      if (fn()) {
        clearInterval(handle);
        resolve();
        return;
      }
    }, 100);
  });
}

async function waitForExit(child) {
  if (child.exitCode !== null) {
    throw new Error(`Child already exited with code ${child.exitCode}`);
  }
  await new Promise((resolve, reject) =>
    child.once('exit', code => {
      if (code) {
        reject(new Error(`Child exited with code ${code}`));
      } else {
        print('Child finished');
        resolve();
      }
    }),
  );
}

async function waitForPageWithText(
  browser,
  path,
  text,
  { intervalMs = 1000, maxLoadAttempts = 240, maxFindTextAttempts = 3 } = {},
) {
  let loadAttempts = 0;
  for (;;) {
    try {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      await browser.visit(path);
      break;
    } catch (error) {
      if (error.message.match(EXPECTED_LOAD_ERRORS)) {
        loadAttempts++;
        if (loadAttempts >= maxLoadAttempts) {
          throw new Error(
            `Failed to load page '${path}', max number of attempts reached`,
          );
        }
      } else {
        throw error;
      }
    }
  }

  // The page may not be fully loaded and hence we need to retry.
  let findTextAttempts = 0;
  const escapedText = text.replace(/"/g, '\\"');
  for (;;) {
    try {
      browser.assert.evaluate(
        `Array.from(document.querySelectorAll("*")).some(el => el.textContent === "${escapedText}")`,
        true,
        `expected to find text ${text}`,
      );
      break;
    } catch (error) {
      findTextAttempts++;
      if (findTextAttempts <= maxFindTextAttempts) {
        await browser.visit(path);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        continue;
      } else {
        throw error;
      }
    }
  }
}

function print(msg) {
  return process.stdout.write(`${msg}\n`);
}

module.exports = {
  spawnPiped,
  handleError,
  waitFor,
  waitForExit,
  waitForPageWithText,
  print,
};
