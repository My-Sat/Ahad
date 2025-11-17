require('dotenv').config(); 
var createError = require('http-errors');
var express = require('express');
const mongoose = require('mongoose');
const methodOverride = require('method-override');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const adminRoutes = require('./routes/admin'); 
const ordersRoutes = require('./routes/orders');
const customersRoutes = require('./routes/customers');
const { ensureAuthenticated } = require('./middlewares/auth');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const authRoutes = require('./routes/auth'); // new file below
const { loadUser } = require('./middlewares/auth');

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

  // static assets (single declaration)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public'))); 

// SESSION config
// trust proxy (important when behind TLS-terminating proxies like Render)
app.set('trust proxy', 1);

// SESSION config
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace_this_with_strong_secret';
const mongoUrl = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos_db';

app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // true in production
    sameSite: 'lax' // works for login redirects while being reasonably strict
  }
}));

// load user from session into req.user and res.locals (must run after session)
app.use(loadUser);

// expose currentUser to templates
app.use(function (req, res, next) {
  res.locals.currentUser = req.user || null;
  next();
});

//ROUTES

// auth routes (public)
app.use('/', authRoutes);


// Protect admin, orders, customers by requiring authentication
app.use('/admin', ensureAuthenticated, adminRoutes);
app.use('/orders', ensureAuthenticated, ordersRoutes);
app.use('/customers', ensureAuthenticated, customersRoutes);

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
