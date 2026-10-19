// A stand-in for an AI agent, for tests: reads standard input and answers in a way that depends on a
// MODE:<name> line in it, so the runner's handling of every kind of answer can be checked without a model.
import fs from 'node:fs';

const input = fs.readFileSync(0, 'utf8');
const mode = (input.match(/MODE:(\w+)/) || [])[1] || 'echo';
switch (mode) {
  case 'sleep': setTimeout(() => {}, 60_000); break;                        // never answers
  case 'fail': console.error('boom: something went wrong'); process.exit(3); break;
  case 'empty': break;
  case 'evil':                                                              // an answer steered by what it was given
    console.log('Summary ![x](https://evil.example/?q=1)\n<img src="http://e/x">\n```dataviewjs\ndv.paragraph(1)\n```\n`= this.file.name`\n<% tp.x %>');
    break;
  case 'env':                                                               // what the runner started it with
    console.log(JSON.stringify({ env: Object.keys(process.env).sort(), cwd: fs.readdirSync(process.cwd()), args: process.argv.slice(2) }));
    break;
  case 'stdin': process.stdout.write(input); break;                         // gives back exactly what it was sent
  default: console.log(`SUMMARY ${input.length}`);
}
