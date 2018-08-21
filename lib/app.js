const http = require('http');

const express = require('express');
const bodyParser = require('body-parser');
const queue = require('queue');
const uuid = require('uuid');

const {
  getOrderBook, placeOrder, cancelOrder, orderBookEvents,
} = require('./exchange');
const { getBalances } = require('./balances');

const workQueue = queue({
  concurrency: 1,
  timeout: 60 * 60 * 1000,
  autostart: true,
});

const app = express();
const server = http.createServer(app);

require('express-ws')(app, server);

app.use(bodyParser.urlencoded({ extended: false }));

const wsClients = {};
app.ws('/ws', (ws /* , req */) => {
  const wsId = uuid.v4();
  wsClients[wsId] = ws;
  ws.on('close', () => {
    delete wsClients[wsId];
  });
  ws.on('error', () => {
    delete wsClients[wsId];
  });
});

function sendWsEvent(type, payload) {
  Object.keys(wsClients).forEach((wsId) => {
    try {
      wsClients[wsId].send(JSON.stringify({
        type,
        payload,
      }));
    } catch (err) {
      // Socket probably got disconnected
      delete wsClients[wsId];
    }
  });
}

['place', 'trade', 'cancel'].forEach(
  type => orderBookEvents.on(type, payload => sendWsEvent(type, payload)),
);

// Convenience route to print the status of the order book and the user balances
app.get('/', (req, res, next) => Promise.all([getOrderBook(), getBalances()])
  .then(([orderBook, balances]) => {
    const stringifiedOrderBook = JSON.stringify(orderBook, null, 2);
    const stringifiedBalances = JSON.stringify(balances, null, 2);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><head><meta http-equiv="refresh" content="2"></head><body><pre>${stringifiedOrderBook}</pre><hr><pre>${stringifiedBalances}</pre></body></html>`);
  })
  .catch(next));

app.get('/order-book', (req, res, next) => getOrderBook()
  .then(orderBook => res.status(200).json(orderBook))
  .catch(next));

app.get('/balances', (req, res, next) => getBalances()
  .then(balances => res.status(200).json(balances))
  .catch(next));

app.post('/order', (req, res, next) => workQueue.push((cb) => {
  placeOrder(req.body.userId, req.body.side, req.body.amount, req.body.price)
    .then(outcome => res.status(200).json(outcome))
    .catch(next)
    .then(() => cb());
}));

app.delete('/order/:id', async (req, res, next) => workQueue.push((cb) => {
  cancelOrder(req.params.id)
    .then(outcome => res.status(200).json(outcome))
    .catch(next)
    .then(() => cb());
}));

/* eslint-disable-next-line no-unused-vars */
app.use((err, req, res, next) => {
  res.status(500).send(err);
});

module.exports = {
  app,
  server,
};
