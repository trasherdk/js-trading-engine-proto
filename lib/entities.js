const uuid = require('uuid');
const { RBTree } = require('bintrees');

const OrderSide = {
  SELL: 'SELL',
  BUY: 'BUY',
};

const OrderType = {
  PLACE: 'PLACE',
  CANCEL: 'CANCEL',
  CANCEL_ALL: 'CANCEL_ALL',
};

/**
 * An entry in one of the order book's rows
 */
class OrderBookEntry {
  constructor(orderBookRow, userId, amount, orderId) {
    this.id = orderId || uuid.v4();

    this.orderBookRow = orderBookRow;
    this.userId = userId;
    this.amount = amount;
    this.value = amount * this.orderBookRow.price;
  }

  remove(amount, value) {
    this.orderBookRow.removeEntry(this, amount, value);
  }
}

/**
 * An order book row
 */
class OrderBookRow {
  constructor(price, orderBookSide) {
    this.price = price;
    this.entries = [];

    this.amount = 0n;
    this.value = 0n;

    this.orderBookSide = orderBookSide;

    // Cache the side in the order book row as well
    this.side = orderBookSide.side;
  }

  pushEntry(userId, amount, orderId) {
    const newEntry = new OrderBookEntry(this, userId, amount, orderId);
    this.entries.push(newEntry);

    this.amount += amount;
    this.value += amount * this.price;

    this.orderBookSide.amount += amount;
    this.orderBookSide.value += amount * this.price;

    return newEntry;
  }

  removeEntry(orderBookEntry, amount, value) {
    // We can either remove the entire entry (no amount provided)
    // or just a part of it (we have an amount and a value)
    if (amount === undefined) {
      amount = orderBookEntry.amount;
      value = orderBookEntry.value;
    }

    if (value === undefined) {
      value = amount * this.price;
    }

    orderBookEntry.amount -= amount;
    orderBookEntry.value -= value;

    this.amount -= amount;
    this.value -= value;

    this.orderBookSide.amount -= amount;
    this.orderBookSide.value -= amount * this.price;

    // Remove entire entry if no amount left
    if (orderBookEntry.amount === 0n) {
      this.entries.splice(this.entries.indexOf(orderBookEntry), 1);
      delete this.orderBookSide.orderBook.orders[orderBookEntry.id];
    }

    // The row is now empty, so we can remove it from the order book side as well
    if (this.entries.length === 0) {
      this.orderBookSide.prices.remove({ price: this.price });
      delete this.orderBookSide.rows[this.price];
    }
  }
}

/**
 * An order book side (sell or buy)
 */
class OrderBookSide {
  constructor(side, orderBook) {
    this.side = side;
    this.prices = side === OrderSide.BUY
      ? new RBTree((l, r) => {
        if (!l || !r) {
          return 0;
        }

        if (l.price < r.price) {
          return 1;
        }
        if (l.price > r.price) {
          return -1;
        }
        return 0;
      })
      : new RBTree((l, r) => {
        if (!l || !r) {
          return 0;
        }

        if (l.price < r.price) {
          return -1;
        }
        if (l.price > r.price) {
          return 1;
        }
        return 0;
      });
    this.rows = {};

    this.amount = 0n;
    this.value = 0n;

    this.orderBook =orderBook;
  }

  pushEntry(userId, price, amount, orderId) {
    let row = this.rows[price];
    if (!row) {
      row = new OrderBookRow(price, this);
      this.prices.insert(row);
      this.rows[price] = row;
    }

    const entry = row.pushEntry(userId, amount, orderId);
    this.orderBook.orders[entry.id] = entry;

    return entry;
  }

  removeRow(price) {
    const row = this.rows[price];

    row.entries.forEach((entry) => entry.remove());
  }
}

/**
 * An order book
 */
class OrderBook {
  constructor(baseTicker, quoteTicker) {
    this.baseTicker = baseTicker;
    this.quoteTicker = quoteTicker;

    this.buy = new OrderBookSide(OrderSide.BUY, this);
    this.sell = new OrderBookSide(OrderSide.SELL, this);

    this.orders = {};
  }

  cancelOrder(orderId) {
    const entry = this.orders[orderId];
    if (!entry) {
      return null;
    }

    const orderSnapshot = {
      id: entry.id,
      userId: entry.userId,
      amount: entry.amount,
      value: entry.value,
      side: entry.orderBookRow.side,
    };
    entry.remove();

    return orderSnapshot;
  }
}

module.exports = {
  OrderSide,
  OrderType,
  OrderBook,
  OrderBookSide,
  OrderBookRow,
  OrderBookEntry,
};
