// routes/books.js
const express = require('express');
const router = express.Router();
const booksController = require('../controllers/books');

// render list page
router.get('/', booksController.listPage);

// list (AJAX)
router.get('/list', booksController.list);

// new page (render) - put BEFORE '/:id' so 'new' is not captured by the id param
router.get('/new', booksController.getNewPage);

// get book by id (AJAX) - returns { ok:true, book }
router.get('/:id', booksController.get);

// create book
router.post('/', booksController.create);

// delete (optional)
router.delete('/:id', booksController.delete);

module.exports = router;
