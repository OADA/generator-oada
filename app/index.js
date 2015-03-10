/* Copyright 2015 Open Ag Data Alliance
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

'use strict';

var generators = require('yeoman-generator');
var encrypt = require('travis-encrypt');
var is = require('is_js');
var objectAssign = require('object-assign');

var npmconf = require('npmconf');
var gitconf = require('git-config');

var testDir = 'test';
var jsonSpaces = 4;

module.exports = generators.Base.extend({
    initializing: {
        default: function() {
            this.conf = {
                main: 'index.js',
                version: '0.0.0'
            };
        },
        dir: function() {
            this.conf.libName =
                    this.destinationPath().match(/\/([^\/]+\/?)$/)[1] ||
                    this.conf.libName;
        },
        gitConfig: function() {
            var done = this.async();
            var generator = this;

            gitconf(function(err, conf) {
                if (err) {
                    generator.log(err);
                    return done();
                }

                generator.conf.name = conf.user.name || generator.conf.name;
                generator.conf.email = conf.user.email || generator.conf.email;

                done();
            });
        },
        npmConfig: function() {
            var done = this.async();
            var generator = this;

            npmconf.load(function(err, conf) {
                if (err) {
                    generator.log(err);
                    return done();
                }

                generator.conf.name = conf.get('name') || generator.conf.name;
                generator.conf.email = conf.get('email') ||
                        generator.conf.email;
                generator.conf.url = conf.get('url') || generator.conf.url;
                generator.conf.npmKey = conf.get('_auth') ||
                        generator.conf.npmKey;

                done();
            });
        },
        packageJson: function() {
            try {
                var json = this.fs.readJSON(
                    this.destinationPath('package.json'),
                    {}
                );

                this.conf.name = (json.author && json.author.name) ||
                            this.conf.name;
                if (typeof json.author === 'object') {
                    this.conf.email = json.author.email || this.conf.email;
                    this.conf.url = json.author.url || this.conf.url;
                }

                this.conf.libName =
                        (json.repository && json.repository.url &&
                            json.repository.url.match(/\/([^\/]+).git$/)[1]) ||
                        json.name || this.conf.libName;
                this.conf.version = json.version || this.conf.version;
                this.conf.main = json.main || this.conf.main;
                this.conf.libDesc = json.description || this.conf.libDesc;
            } catch (err) {
                this.log(err);
            }
        }
    },

    prompting: {
        general: function() {
            var done = this.async();
            var generator = this;

            var prompts = [
                {
                    store: false,
                    name: 'libName',
                    type: 'input',
                    default: this.conf.libName,
                    message: 'What do you want to call your lib?'
                },
                {
                    store: true,
                    name: 'libDesc',
                    type: 'input',
                    default: this.conf.libDesc,
                    message: 'Describe your library:'
                },
                {
                    store: true,
                    name: 'authorName',
                    type: 'input',
                    default: this.conf.name,
                    message: 'What is the Author\'s name?'
                },
                {
                    store: true,
                    name: 'authorEmail',
                    type: 'input',
                    default: this.conf.email,
                    message: 'What is the Author\'s email?',
                    validate: is.email
                },
                {
                    store: true,
                    name: 'authorUrl',
                    type: 'input',
                    default: this.conf.url,
                    message: 'What is the Author\'s URL (optional)?',
                    validate: function(str) {return !str || is.url(str);}
                },
                {
                    store: false,
                    name: 'copyrightYear',
                    type: 'input',
                    message: 'What year is the copyright?',
                    default: function() {
                        return generator.config.get('copyrightYear') ||
                                (new Date(Date.now())).getFullYear();
                    },
                    validate: function(str) {return is.number(+str);},
                    filter: function(year) {
                        generator.config.set('copyrightYear', year);
                        return year;
                    }
                }
            ];

            this.prompt(prompts, function(ans) {
                this.context = objectAssign({}, this.conf, ans);

                this.context.repoName = ans.libName;
                this.context.packageName = ans.libName
                        .replace(/^node-/, '')
                        .replace(/[.-]?js$/, '');
                this.context.varName = this.context.packageName
                        .replace(/[-_.](.)/g, function(m, p) {
                            return p.toUpperCase();
                        });

                this.context.authorJSON = JSON.stringify(
                        {
                            name: ans.authorName,
                            email: ans.authorEmail,
                            url: ans.authorUrl || undefined
                        },
                        null,
                        2
                    ).replace(/\n/g, '\n  ');
                this.context.authorStr = ans.authorName +
                    ' <' + ans.authorEmail + '>' +
                    (ans.authorUrl && (' (' + ans.authorUrl + ')'));

                done();
            }.bind(this));
        },
        genNpmKey: function() {
            var done = this.async();
            var generator = this;

            this.prompt([
                    {
                        store: false,
                        name: 'genNpmKey',
                        type: 'confirm',
                        default: false,
                        message: 'Regenerate Travis NPM API key?',
                        when: function() {
                            return !!generator.config.get('travisNpmKey');
                        },
                    },
                    {
                        store: false,
                        name: 'npmApiKey',
                        type: 'input',
                        default: generator.conf.npmKey,
                        message: 'Enter NPM API key, or username:password.',
                        when: function(ans) {
                            return ans.genNpmKey ||
                                !generator.config.get('travisNpmKey');
                        },
                        filter: function(str) {
                            return str.indexOf(':') === -1 ? str :
                                    (new Buffer(str)).toString('base64');
                        }
                    }
                ],
                function(ans) {
                    if (!ans.npmApiKey) {return done();}
                    encrypt(
                        'OADA/' + generator.context.repoName,
                        ans.npmApiKey,
                        undefined, undefined,
                        function(err, blob) {
                            if (err) {
                                generator.log(err);
                            } else {
                                generator.config.set('travisNpmKey', blob);
                            }

                            done();
                        }
                    );
                }.bind(this)
            );
        }
    },

    configuring: {
        license: function() {
            this.fs.copy(
                this.templatePath('_LICENSE'),
                this.destinationPath('LICENSE')
            );
            this.fs.copyTpl(
                this.templatePath('_AUTHORS'),
                this.destinationPath('AUTHORS'),
                this.context
            );
            this.fs.copyTpl(
                this.templatePath('_NOTICE'),
                this.destinationPath('NOTICE'),
                this.context
            );
        },
        readme: function() {
            this.fs.copyTpl(
                this.templatePath('_README.md'),
                this.destinationPath('README.md'),
                this.context
            );
        },
        editorconfig: function() {
            this.fs.copy(
                this.templatePath('editorconfig'),
                this.destinationPath('.editorconfig')
            );
        },
        jshint: function() {
            this.fs.copy(
                this.templatePath('jshintrc'),
                this.destinationPath('.jshintrc')
            );
            this.fs.copy(
                this.templatePath('jshintignore'),
                this.destinationPath('.jshintignore')
            );
        },
        jscs: function() {
            this.fs.copy(
                this.templatePath('jscsrc'),
                this.destinationPath('.jscsrc')
            );
        },
        mocha: function() {
            this.fs.copy(
                this.templatePath('test/mocha.opts'),
                this.destinationPath(testDir + '/mocha.opts')
            );
            this.fs.writeJSON(
                this.destinationPath(testDir + '/.jshintrc'),
                objectAssign(
                    this.fs.readJSON(this.templatePath('jshintrc')),
                    this.fs.readJSON(this.templatePath('test/jshintrc-mocha'))
                ),
                null,
                jsonSpaces
            );
        },
        npm: function() {
            this.fs.copyTpl(
                this.templatePath('_package.json'),
                this.destinationPath('package.json'),
                this.context
            );
        },
        git: function() {
            this.fs.copy(
                this.templatePath('gitignore'),
                this.destinationPath('.gitignore')
            );
        },
        travis: function() {
            this.context.travisNpmKey = this.config.get('travisNpmKey');
            this.fs.copyTpl(
                this.templatePath('travis.yml'),
                this.destinationPath('.travis.yml'),
                this.context
            );
        }
    },

    writing: {
        main: function() {
            this.fs.copyTpl(
                this.templatePath('index.js'),
                this.destinationPath(this.context.main),
                this.context
            );
        },
        test: function() {
            this.fs.copyTpl(
                this.templatePath('test/test.js'),
                this.destinationPath(
                    testDir + '/' + this.context.packageName + '.test.js'),
                this.context
            );
        }
    },

    install: {
        istanbul: function() {
            this.npmInstall(['istanbul'], {saveDev: true});
        },
        mocha: function() {
            this.npmInstall(['mocha'], {saveDev: true});
        },
        chai: function() {
            this.npmInstall(['chai'], {saveDev: true});
        },

        jshint: function() {
            this.npmInstall(['jshint', 'jshint-stylish'], {saveDev: true});
        },
        jscs: function() {
            this.npmInstall(['jscs'], {saveDev: true});
        }
    }
});