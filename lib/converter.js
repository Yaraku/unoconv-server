const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const _ = require('lodash');
const pad = require('pad');
const { PassThrough } = require('stream');
const archiver = require('archiver');
const rimraf = require("rimraf");
const ps = require('ps-node');

const exec = util.promisify(childProcess.exec);

const regexCommandHelp = /^\s+(?:\-([a-zA-Z]),\s)?--([a-z]+)(?:=([a-z=]+))\s+(.+)$/;

const availableOptions = [
  'export',
  'format',
  'field',
  'import',
  'filter',
  'output',
  'filter',
  'password',
];

class Converter {

  constructor() {
    this.init();
  }

  init() {
    this._ready = exec('unoconv --help')
    .then((result) => {
      this.helpText = result.stderr;
      this.parseHelpInfo();
    });
  }

  ready() {
    return this._ready;
  }

  startListener() {
    console.log('# starting unoconv listener...');
    this.listener = childProcess.spawn('unoconv', ['--listener']);
  }

  stopListener() {
    console.log('# stopping unoconv listener');
    if (this.listener) {
      console.error('# unoconv listener not is started');
      this.listener.kill();
    }
  }

  parseHelpInfo() {
    const lines = this.helpText.split('\n');
    const options = [];
    const help = [
      'unoconv-server, a simple RESTful server for converting documents',
      '  please visit https://github.com/alphakevin/unoconv-server',
      '',
      'converting:',
      '  upload with multipart/form-data:',
      '    curl -F file=@example.docx http://127.0.0.1:4000/convert/format/pdf/output/newname.pdf > result.pdf',
      '  upload raw:',
      '    curl -X POST \\',
      '      -T "example.docx" \\',
      '      -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \\',
      '      -H "Content-Disposition: attachment; filename=\"example.docx\"" \\',
      '      http://127.0.0.1:4000/convert/format/pdf/output/newname.pdf > result.pdf',
      '',
      'converter options:',
    ];
    lines.forEach(line => {
      const result = regexCommandHelp.exec(line);
      if (!result) return;
      const [undefined, short, option, valueStr, message] = result;
      const opt = {
        short,
        option,
        hasValue: !!valueStr,
        isPublic: availableOptions.includes(option),
      };
      options.push(opt);
      if (opt.isPublic) {
        help.push(`  ${opt.short ? `/${opt.short},` : '   '} /${pad(`${opt.option}/<value>`, 17)}  ${message}`);
      }
    });
    help.push('');
    this.converterHelpText = help.join('\n');
    this.options = options;
  }

  parseUrlCommand(commands) {
    const list = commands.split('/');
    const args = [];
    const options = {};
    let option = list.shift();
    while (option) {
      const define = _.find(this.options, o => o.option === option || o.short === option);
      if (!define) {
        throw new Error(`invalid option '${option}'`);
      }
      const prefix = option.length === 1 ? '-' : '--';
      args.push(`${prefix}${option}`)
      option = define.option;
      if (define.hasValue) {
        const value = list.shift();
        if (option === 'format' && value === 'txt') {
          args.push('text');
        } else {
          args.push(value);
        }
        options[option] = value;
      } else {
        options[option] = true;
      }
      option = list.shift();
    }
    if (!options.format) {
      options.format = 'pdf';
    }
    return {
      args,
      options,
    };
  }

  getHelpText() {
    return this.converterHelpText;
  }

  convert(inputFile, args, options) {
    const isHtml = options.format && options.format === 'html';

    const outputDirPath = isHtml
      ? os.tmpdir() + '/' + path.parse(inputFile).name
      : os.tmpdir();

    const outputFile = `${outputDirPath}/${path.parse(options.output || inputFile).name}.${options.format}`;

    const timeout = options.timeout > 0 ? options.timeout : 600;

    console.log(args, options, outputFile);
    args.push('--output', outputFile);
    args.push(inputFile);
    console.log(`unoconv ${args.join(' ')}`);

    const conversion = new Promise((resolve, reject) => {
      const handler = childProcess.spawn('unoconv', args);
      const errors = [];
      handler.stderr.on('data', error => {
        errors.push(error);
      });
      handler.on('exit', () => {
        if (errors.length) {
          return reject(new Error(Buffer.concat(errors).toString()));
        }

        if (fs.existsSync(outputFile) === false) {
          return reject(new Error(`No result from conversion (probably timed out after ${timeout}s)`));
        }

        if (isHtml) {
          const archiveFilePath = outputDirPath + '.zip';
          let archiveFileStream = fs.createWriteStream(archiveFilePath);

          let archive = archiver('zip', { zlib: { level: 9 } });

          archive.pipe(archiveFileStream);

          archiveFileStream.on('close', function() {
            rimraf(outputDirPath, function () { console.log("'" + outputDirPath + "' removed"); });

            resolve(archiveFilePath);
          });

          archive.directory(outputDirPath, false)
            .finalize();
        } else {
          resolve(outputFile);
        }
      });

      setTimeout(() => {
        handler.kill()
      }, timeout * 1000);
    });

    conversion.catch(() => {
      this.killSoffice();
    });

    return conversion;
  }

  convertToStream(inputFile, args, options) {
    args.push('--stdout');
    args.push(inputFile);
    const output = new PassThrough();
    if (options.format === 'txt') {
      output.setEncoding('utf8');
    }
    console.log(`unoconv ${args.join(' ')}`);
    const errors = '';
    const handler = childProcess.spawn('unoconv', args);
    handler.stderr.setEncoding('utf8');
    handler.stderr.on('data', data => {
      errors += data;
    });
    handler.on('exit', (code) => {
      fs.unlinkSync(inputFile);
      if (code > 0 || errors.length) {
        output.emit('error', errors);
      }
    });
    handler.stdout.pipe(output);
    return output;
  }

  killSoffice() {
    ps.lookup({
      command: '/usr/lib/libreoffice/program/soffice.bin',
      psargs: 'ux'
    }, (err, resultList) => {
      if (err) {
        throw new Error( err );
      }

      resultList.forEach((process) => {
        if (process) {
          console.log('PID: %s, COMMAND: %s', process.pid, process.command);

          ps.kill(process.pid, function( err ) {
            if (err) {
              throw new Error(err);
            } else {
              console.log('Process %s has been killed', process.pid);
            }
          });
        }
      });
    });
  }
}

module.exports = Converter;
