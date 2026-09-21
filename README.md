# Ahad

## Business Operations & Point-of-Sale Management System

Ahad is a full-stack business operations and point-of-sale management application built with **Node.js, Express.js, MongoDB, Mongoose and Pug**.

The system is designed to manage day-to-day business activities including order processing, payments, customers, inventory, service pricing, accounting, reporting and staff permissions from a centralized application.

## Key Features

### Orders & Payments

* Create and manage customer orders
* Dynamic service pricing
* Multiple payment methods
* Partial payment support
* Outstanding balance and debtor tracking
* Customer account payments
* Discount handling
* Payment history

### Services & Pricing

* Service management
* Service categories
* Units and sub-units
* Dynamic pricing rules
* Compound services
* Printer-dependent services
* Front/back printing calculations

### Inventory & Materials

* Material catalogue management
* Store-based stock management
* Operational store configuration
* Stock adjustments
* Stock transfers
* Material usage tracking
* Automatic stock validation during order creation
* Low-stock monitoring

### Printer Usage

* Printer management
* Printer usage recording
* Colour and monochrome usage tracking
* Usage counters and reporting

### Customer Management

* Customer records
* Multiple customer types
* Customer account balances
* Account transaction history
* Customer search and lookup
* Debtor management

### Accounting & Reporting

* Accounting workflows
* Cash books
* Cashier records
* Transaction tracking
* Business reports
* Financial activity monitoring

### User Access & Permissions

* User management
* Role-based access control
* Permission-based route protection
* Administrative and staff access levels
* Secure session-based authentication

### Additional Features

* Supplier management
* Messaging functionality
* Service discounts
* Enquiries
* Registration management
* Business reporting tools

## Technology Stack

### Backend

* Node.js
* Express.js
* MongoDB
* Mongoose

### Frontend

* Pug
* JavaScript
* Bootstrap
* HTML
* CSS

### Authentication & Application Services

* Express Session
* Connect Mongo
* bcrypt
* Axios
* dotenv

## Project Structure

```text
Ahad/
├── controllers/     # Application and business logic
├── middlewares/     # Authentication and permission middleware
├── models/          # Mongoose database models
├── public/          # Client-side JavaScript, CSS and static assets
├── routes/          # Express application routes
├── scripts/         # Utility and migration scripts
├── utilities/       # Shared application utilities
├── views/           # Pug templates
├── app.js           # Express application configuration
├── server.js        # Application server entry point
└── package.json
```

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/My-Sat/Ahad.git
```

### 2. Enter the project directory

```bash
cd Ahad
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root.

Example:

```env
MONGO_URI=your_mongodb_connection_string
SESSION_SECRET=your_session_secret
```

Additional environment variables may be required for optional external integrations.

> The `.env` file is excluded from version control and should never be committed to the repository.

### 5. Start the application

For development:

```bash
npm run dev
```

For normal execution:

```bash
npm start
```

## Architecture

The application follows a traditional MVC-style structure:

* **Models** define MongoDB data structures using Mongoose.
* **Controllers** contain business and application logic.
* **Routes** expose application endpoints.
* **Middleware** handles authentication and authorization.
* **Views** provide the server-rendered user interface using Pug.
* **Client-side JavaScript** handles interactive functionality in the browser.

## What This Project Demonstrates

This project demonstrates practical experience with:

* Designing and implementing business workflows
* Building Node.js and Express.js applications
* MongoDB and Mongoose data modelling
* Authentication and authorization
* Role-based access control
* Complex order and pricing calculations
* Inventory and stock-management logic
* Payment and customer-account workflows
* Server-side rendered applications
* REST-style API development
* Business reporting
* Working with multi-module codebases
* Git and GitHub version control

## Security

Sensitive information such as database credentials and application secrets is stored using environment variables and is excluded from source control.

## Author

**Ibrahim Iddrisu Chenti**

Full-Stack JavaScript Developer

**Core technologies:** Node.js, Express.js, React, MongoDB, Mongoose and REST APIs

