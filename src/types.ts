/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TransactionType = 'IN' | 'OUT';

export interface Product {
  id: string;
  name: string;
  unit: string;
  initialStock: number;
}

export interface Transaction {
  id: string;
  productId: string;
  type: TransactionType;
  quantity: number;
  timestamp: string;
  currentStockAtTime: number;
}

export interface InventoryItem extends Product {
  currentStock: number;
}
