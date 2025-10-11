const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');

// Routers
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');

const app = express();

/**
 * Middleware setup
 */
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Allow CORS (for API or frontend calls)
app.use(cors({
  origin: '*', // You can restrict this to your frontend domain later
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', indexRouter);
app.use('/users', usersRouter);

/**
 * Catch 404 and forward to error handler
 */
app.use((req, res, next) => {
  next(createError(404, 'Resource not found'));
});

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  // Set locals (useful for rendering error pages)
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // Log the error for debugging
  console.error(`[ERROR] ${err.status || 500} - ${err.message}`);

  // For APIs: return JSON
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal Server Error'
    });
  }

  // For web routes: render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
