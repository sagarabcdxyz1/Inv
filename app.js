const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('express-flash');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const app = express();

// MySQL Connection
const db = mysql.createConnection({
  host: 'b14y8z2geenrzmxbddpk-mysql.services.clever-cloud.com',
  user: 'uacbfalxyvgscd9z',
  password: '8R0sDz3z6nRDY0Kg4Afg',
  database: 'b14y8z2geenrzmxbddpk',
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// Configure session store
const sessionStore = new MySQLStore({
    expiration: 86400000, // 1 day
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  }, db.promise());


// Pug Configuration
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(session({
    secret: 'your-secret-key',
    resave: true,
    saveUninitialized: true,
    store: sessionStore,
  }));

app.use(flash());



// Middleware to set flash messages
const setFlashMessages = (req, res) => {
    res.locals.messages = {
      success: req.flash('success'),
      error: req.flash('error'),
    };
    req.messages = res.locals.messages;
  };
  
// Static Files
app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));
app.use('/fontawesome', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free')));
app.use('/jquery', express.static(path.join(__dirname, 'node_modules/jquery/dist')));
app.use('/datatables.net-bs5', express.static(path.join(__dirname, 'node_modules/datatables.net-bs5')));

app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));



app.use(passport.initialize());
app.use(passport.session());



  const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
      return next();
    }
    req.flash('error','Please log in to access this site.');
    res.redirect('/login');
  };

// Routes
app.get('/', ensureAuthenticated, async (req, res) => {
  const products = await getProductsWithPrices();
  setFlashMessages(req, res);
  res.render('index', { products, messages: res.locals.messages });
});

app.get('/login', (req, res) => {
    setFlashMessages(req, res);
    res.render('login', { messages: res.locals.messages });
  });

  app.get('/dashboard', ensureAuthenticated, async (req, res) => {
    try {
      const dailySellsData = await getChartData('daily', 'sell');
      const monthlySellsData = await getChartData('monthly', 'sell');
      const yearlySellsData = await getChartData('yearly', 'sell');
      const buysData = await getChartData('daily', 'buy');
  
      res.render('dashboard', {
        dailySellsData: JSON.stringify(dailySellsData),
        monthlySellsData: JSON.stringify(monthlySellsData),
        yearlySellsData: JSON.stringify(yearlySellsData),
        buysData: JSON.stringify(buysData),
        messages: res.locals.messages,
      });
    } catch (error) {
      console.error('Error fetching chart data:', error);
      req.flash('error', 'Error fetching chart data.');
      res.redirect('/');
    }
  });
  
  async function getChartData(timeInterval, transactionType) {
    const timeFormat = getTimeFormat(timeInterval);
  console.log(timeFormat);
    // Query to get data based on time interval
    const query = `
      SELECT DATE(transaction_date) AS time,
             SUM(quantity) AS totalQuantity,
             SUM(price * quantity) AS totalPrice
      FROM inventory
      WHERE transaction_type = ?
      GROUP BY time
      ORDER BY time DESC
      LIMIT 7;`;
  
    const [rows] = await db.promise().query(query, [transactionType]);
  
    const labels = rows.map(row => row.time);
    const data = rows.map(row => row.totalQuantity);
  
    return { labels, data };
  }
  
  function getTimeFormat(timeInterval) {
    switch (timeInterval) {
      case 'daily':
        return 'DATE';
      case 'monthly':
        return 'DATE_FORMAT(transaction_date, "%Y-%m")';
      case 'yearly':
        return 'YEAR';
      default:
        throw new Error('Invalid time interval');
    }
  }

app.post('/add-product', async (req, res) => {
  const { name, defaultPrice } = req.body;
  await addProduct(name, defaultPrice);
  res.redirect('/');
});

app.get('/logout', function (req, res){
    req.session.destroy(function (err) {
      res.redirect('/'); //Inside a callback… bulletproof!
    });
  });

app.post('/add-inventory', async (req, res) => {
  const { productId, quantity, price } = req.body;
  await addInventory(productId, quantity, price, 'buy');
  req.flash('success','Inventory added successfully!');
  res.redirect('/');
});

app.post('/sell-inventory', async (req, res) => {
    const { productId, quantity, sellPrice } = req.body;
    await sellInventory(req, productId, quantity, sellPrice);
  res.redirect('/');
});

async function getProductsWithPrices() {
  const products = await db.promise().query('SELECT * FROM products');
  const transactions = await db.promise().query('SELECT * FROM inventory ORDER BY transaction_date DESC');
  
  return products[0].map(product => {
    const latestTransaction = transactions[0].find(t => t.product_id === product.id);
    if (latestTransaction) {
      product.price = latestTransaction.price || product.default_price;
      product.stock = calculateStock(transactions[0], product.id);
    } else {
      product.price = product.default_price;
      product.stock = 0;
    }
    return product;
  });
}

async function addProduct(name, defaultPrice) {
  await db.promise().execute('INSERT INTO products (name, default_price) VALUES (?, ?)', [name, defaultPrice]);
}

async function addInventory(productId, quantity, price, transactionType) {
  await db.promise().execute('INSERT INTO inventory (product_id, price, quantity, transaction_type) VALUES (?, ?, ?, ?)', [productId, price, quantity, transactionType]);
}

async function sellInventory(req, productId, quantity, sellPrice) {
    const transactions = await db.promise().query('SELECT * FROM inventory ORDER BY transaction_date DESC');
    const availableStock = await calculateStock(transactions[0], productId);
    if (availableStock >= quantity) {
      await addInventory(productId, quantity, sellPrice, 'sell');
      req.flash('success','Product sold successfully!');
    } else {
        req.flash('error','Insufficient stock to sell.');
    }
  }
  
  function calculateStock(transactions, productId) {
      if (!transactions || transactions.length === 0) {
          return 0;
        }
        
    const productTransactions = transactions.filter(t => t.product_id == productId);
    const totalBuyQuantity = productTransactions
      .filter(t => t.transaction_type === 'buy')
      .reduce((sum, t) => sum + t.quantity, 0);
    const totalSellQuantity = productTransactions
      .filter(t => t.transaction_type === 'sell')
      .reduce((sum, t) => sum + t.quantity, 0);
    return totalBuyQuantity - totalSellQuantity;
  }



// Configure Google authentication
const GOOGLE_CLIENT_ID = '213981044030-88u4tqhiqvhgv06tdsn0dvbhin4vls88.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
//   callbackURL: '/auth/google/callback',
  callbackURL: 'https://inventory-simple.vercel.app/auth/google/callback',
//   callbackURL: 'http://localhost:3000/auth/google/callback',
}, (accessToken, refreshToken, profile, done) => {
    const allowedEmails = ['rs4093@gmail.com'];
  if (allowedEmails.includes(profile.emails[0].value)) {
    return done(null, profile);
  } else {
    return done(null, false, { message: 'Unauthorized email address.' });
  }
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Add Google authentication routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/');
  });

  

  module.exports = app;
// Start the server
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });


