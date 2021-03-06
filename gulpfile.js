var gulp = require('gulp');
var stylus = require('gulp-stylus');
var uglify = require('gulp-uglify');
var concat = require('gulp-concat');
var jade = require('gulp-jade');
var source = require('vinyl-source-stream');
var runsequence = require('run-sequence');
var envify = require('envify/custom');
var browserify = require('browserify');
var eslint = require('gulp-eslint');
var mocha = require('gulp-mocha');
var del = require('del');
var nib = require('nib');
var stream = require('stream');
var _ = require('lodash');

var argv = require('minimist')(process.argv.slice(2));
var cfg = require('./cfg.json');
var gulputil = require('./gulputil.js');

var _devEnvironment = {
  name: 'dev',
  root: cfg.dir.root.dev,
  appFilename: 'app.js',
  libFilename: 'lib.js',
  appConfiguration: cfg.appConfigurations.develop
};

var _dev2Environment = _.assign({}, _devEnvironment, {
  name: 'dev2',
  appConfiguration: cfg.appConfigurations.develop2
});

var _localhostEnvironment = _.assign({}, _devEnvironment, {
  name: 'localhost',
  appConfiguration: cfg.appConfigurations.localhost
});

var _productionEnvironment = {
  name: 'production',
  root: cfg.dir.root.production,
  appFilename: gulputil.buildCacheBusterString(7) + '.js',
  libFilename: gulputil.buildCacheBusterString(8) + '.js',
  appConfiguration: cfg.appConfigurations.production
};

var environment = _.assign({}, _devEnvironment);

var npmReferences = _.map(cfg.npmLibraries, function (l) {
  var pkgFile = require('./node_modules/' + l + '/package.json');
  return {
    name: l,
    mainFilePath: './node_modules/' + l + '/' + pkgFile.main
  };
});

gulp.task('clean', function () {
  return del([environment.root]);
});

gulp.task('libraries', function () {

  var b = browserify({ entries: _.map(npmReferences, 'mainFilePath') });

  _.forEach(npmReferences, function (r) { b.require(r.mainFilePath, {expose: r.name}); });

  return b.transform(envify({NODE_ENV: environment.name === 'production' ? 'production' : 'development'}))
    .transform({
      global: true,
      compress: environment.name === 'production',
      mangle: environment.name === 'production',
      sourcemap: false
    }, 'uglifyify')
    .bundle()
    .pipe(source(environment.libFilename))
    .pipe(gulp.dest(environment.root + cfg.dir.type.destination.js));
});

gulp.task('scripts', function () {

  var configStream = new stream.Readable();
  configStream.push('module.exports=' + JSON.stringify(environment.appConfiguration));
  configStream.push(null);

  var scriptSourceDir = cfg.dir.root.src + cfg.dir.type.source.scripts;
  var b = browserify({
    entries: scriptSourceDir + 'app.jsx',
    extensions: ['.js', '.jsx'],
    paths: [scriptSourceDir],
    debug: environment.name !== _productionEnvironment.name
  }).exclude('appconfiguration')
    .require(configStream, {expose: 'appconfiguration', basedir: './src/scripts'});

    return b.transform('babelify', {
		presets: ['react'],
		plugins: ["transform-object-rest-spread"]
	})
    .external(_.map(npmReferences, 'name'))
    .bundle()
    .on('error', function (err) {
      console.error(err.toString());
      this.emit('end');
    })
    .pipe(source(environment.appFilename))
    .pipe(gulp.dest(environment.root + cfg.dir.type.destination.js));

});

gulp.task('styles', function () {
  return gulp.src(cfg.dir.root.src + cfg.dir.type.source.styles + '[!_]*.styl')
    .pipe(stylus({
      use: [nib()],
      define: {"app-environment": environment.name},
      'include css': true
    }))
    .pipe(gulp.dest(environment.root + cfg.dir.type.destination.css));
});

gulp.task('views', function () {
  return gulp.src(cfg.dir.root.src + cfg.dir.type.source.views + '[!_]*.jade')
    .pipe(jade({
      pretty: true,
      data: {
        js_appFile: 'js/' + environment.appFilename,
        js_libFile: 'js/' + environment.libFilename,
        environment: environment.name
      }
    }))
    .pipe(gulp.dest(environment.root + cfg.dir.type.destination.html));
});

gulp.task('resources', function () {
  return gulp.src(cfg.dir.root.src + cfg.dir.type.source.resources + '*.*')
    .pipe(gulp.dest(environment.root + cfg.dir.type.destination.assets));
});

gulp.task('lint', function () {
  return gulp.src(cfg.dir.root.src + cfg.dir.type.source.scripts + '**/*.@(js|jsx)')
    .pipe(eslint({
      extends: 'eslint:recommended',
      parserOptions: {
        "ecmaVersion": 6,
        "sourceType": "module",
        "ecmaFeatures": {
          "experimentalObjectRestSpread": true,
          "jsx": true
        }
      },
      plugins: [
        "react"
      ],
      rules: {
        "no-console": "warn",
        "no-unused-vars": "off"
      },
      globals: {
        'console': true,
        'window': true,
        'document': true,
        'React': true,
        'ReactDOM': true,
        '_': true,
        'postal': true,
        'oboe': true,
        'Promise': true,
        'process': true
      },
      env: {
        'commonjs': true
      }
    }))
    .pipe(eslint.format());
    // .pipe(eslint.failAfterError());
});

gulp.task('test', function () {
  return gulp.src([cfg.dir.root.test + '**/*.test.js'], {read: false})
    .pipe(mocha({
      harmony: true,
      reporter: 'min'
    }));
});

gulp.task('watch', function () {
  if (_.includes(_.keys(argv), 'localhost') && !_.includes(_.keys(argv), 'dev2')) { // --localhost
    environment = _.assign({}, environment, _localhostEnvironment);
  } else if (_.includes(_.keys(argv), 'dev2') && !_.includes(_.keys(argv), 'localhost')) { // --dev2
    environment = _.assign({}, environment, _dev2Environment);
  }

  var paths = cfg.dir.type.source;
  var root = cfg.dir.root.src;

  gulp.watch(root + paths.scripts + '**/*.@(jsx|js)', ['lint', 'scripts']);
  gulp.watch(root + paths.scripts + '**/*.@(jsx|js)', ['test']);
  gulp.watch(cfg.dir.root.test + '**/*.test.js', ['test']);
  gulp.watch(root + paths.styles + '*.styl', ['styles']);
  gulp.watch(root + paths.views + '*.jade', ['views']);
  gulp.watch(root + paths.resources + '*.*', ['resources']);

});

gulp.task('build', function () {
  return runsequence('clean', 'lint', ['libraries', 'test', 'scripts', 'styles', 'views', 'resources']);
});

gulp.task('dev', function () {
  if (_.includes(_.keys(argv), 'localhost')) {
    environment = _.assign({}, environment, _localhostEnvironment);
  }
  if (gulp.tasks.build) return gulp.start('build');
  else throw new Error('No build task found');
});

gulp.task('dev2', function () {
  environment = _.assign({}, environment, _dev2Environment);
  if (gulp.tasks.build) return gulp.start('build');
  else throw new Error('No build task found');
});

gulp.task('production', function () {
  environment = _.assign({}, environment, _productionEnvironment);
  if (gulp.tasks.build) return gulp.start('build');
  else throw new Error('No build task found');
});

gulp.task('default', ['dev']);