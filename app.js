require('dotenv').config(); 
var createError = require('http-errors');
var express = require('express');
const mongoose = require('mongoose');
const methodOverride = require('method-override');

var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

// adapt these to your actual route filenames
const adminRoutes = require('./routes/admin'); 
const apiRoutes = require('./routes/api'); 
const ordersRoutes = require('./routes/orders');

var app = express();

// view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// logger
app.use(logger('dev'));

// body parsing (use express built-ins)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// cookies
app.use(cookieParser());

// method override for HTML forms e.g. ?_method=DELETE
app.use(methodOverride('_method'));

// static assets (single declaration)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public'))); 

// connect to mongo (change URI as needed)
// prefer to set MONGO_URI in env or .env file
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos_db';

// Optional: disable strictQuery warnings (depends on your mongoose version)
mongoose.set('strictQuery', false);

mongoose.connect(MONGO_URI)
  .then(()=> console.log('Mongo connected'))
  .catch(err => {
    console.error('Mongo connection error', err);
    // you might want to exit the process if DB is required:
    // process.exit(1);
  });

// routes
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/orders', ordersRoutes);

app.get('/', (req, res) => res.send('POS Service Section running. Visit /admin/services'));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
