/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, ReactNode, FormEvent } from 'react';
import { 
  PlusCircle, 
  MinusCircle, 
  History, 
  Package, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar,
  Clock,
  LayoutDashboard,
  Search,
  CheckCircle2,
  AlertCircle,
  Settings,
  Plus,
  Trash2,
  X,
  Menu,
  Lock,
  User,
  LogIn,
  Printer,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product, Transaction, InventoryItem, TransactionType } from './types';
import { db } from './lib/firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  getDocFromServer
} from 'firebase/firestore';

const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Riz (Grain long)', unit: 'kg', initialStock: 0 },
  { id: '2', name: 'Huile Végétale', unit: 'L', initialStock: 0 },
  { id: '3', name: 'Sucre Blanc', unit: 'kg', initialStock: 0 },
  { id: '4', name: 'Savon de ménage', unit: 'pcs', initialStock: 0 },
  { id: '5', name: 'Farine', unit: 'kg', initialStock: 0 },
];

const CREDENTIALS = {
  username: 'kona',
  password: '1430'
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('ppn_auth') === 'true';
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'day' | 'week' | 'month' | 'custom'>('all');
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'setup'>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [quickMoveProduct, setQuickMoveProduct] = useState<{ id: string, name: string, type: TransactionType, currentStock: number } | null>(null);

  // Connection testing and initial sync with Firestore
  useEffect(() => {
    if (!isAuthenticated) return;

    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'system', 'ping'));
      } catch (error) {
        console.error("Firebase connection check:", error);
      }
    }
    testConnection();

    // Subscribe to products
    const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
      const prods = snapshot.docs.map(doc => doc.data() as Product);
      if (prods.length === 0 && loading) {
        // If first time, initialize with defaults
        INITIAL_PRODUCTS.forEach(p => {
          setDoc(doc(db, 'products', p.id), p);
        });
      } else {
        setProducts(prods);
      }
    });

    // Subscribe to transactions
    const unsubTx = onSnapshot(query(collection(db, 'transactions'), orderBy('timestamp', 'desc')), (snapshot) => {
      setTransactions(snapshot.docs.map(doc => doc.data() as Transaction));
      setLoading(false);
    });

    return () => {
      unsubProducts();
      unsubTx();
    };
  }, [isAuthenticated]);

  // Inventory calculation logic
  const inventory = useMemo<InventoryItem[]>(() => {
    return products.map(prod => {
      const prodTransactions = transactions.filter(t => t.productId === prod.id);
      const totalIn = prodTransactions
        .filter(t => t.type === 'IN')
        .reduce((sum, t) => sum + t.quantity, 0);
      const totalOut = prodTransactions
        .filter(t => t.type === 'OUT')
        .reduce((sum, t) => sum + t.quantity, 0);
      
      return {
        ...prod,
        currentStock: prod.initialStock + totalIn - totalOut
      };
    });
  }, [products, transactions]);

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Filter by product name
    if (historySearchTerm) {
      filtered = filtered.filter(t => {
        const prod = products.find(p => p.id === t.productId);
        return prod?.name.toLowerCase().includes(historySearchTerm.toLowerCase());
      });
    }

    // Filter by date
    if (historyFilter === 'all') return filtered;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    return filtered.filter(t => {
      const tDate = new Date(t.timestamp);
      if (historyFilter === 'day') {
        return tDate >= today;
      }
      if (historyFilter === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return tDate >= weekAgo;
      }
      if (historyFilter === 'month') {
        const monthAgo = new Date(now);
        monthAgo.setMonth(now.getMonth() - 1);
        return tDate >= monthAgo;
      }
      if (historyFilter === 'custom') {
        if (!historyStartDate && !historyEndDate) return true;
        const start = historyStartDate ? new Date(historyStartDate) : new Date(0);
        const end = historyEndDate ? new Date(historyEndDate) : new Date();
        // Set end to end of day
        end.setHours(23, 59, 59, 999);
        return tDate >= start && tDate <= end;
      }
      return true;
    });
  }, [transactions, historyFilter, historySearchTerm, historyStartDate, historyEndDate, products]);

  const handlePrint = () => {
    window.print();
  };

  const transactionsByProduct = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    filteredTransactions.forEach(t => {
      const prod = products.find(p => p.id === t.productId);
      const prodName = prod?.name || 'Inconnu';
      if (!groups[prodName]) groups[prodName] = [];
      groups[prodName].push(t);
    });
    return groups;
  }, [filteredTransactions, products]);

  const addTransaction = async (productId: string, type: TransactionType, quantity: number, currentStock: number) => {
    if (quantity <= 0) return;
    
    // Final stock after this transaction
    const finalStock = type === 'IN' ? currentStock + quantity : currentStock - quantity;
    
    const id = crypto.randomUUID();
    const newTransaction: Transaction = {
      id,
      productId,
      type,
      quantity,
      timestamp: new Date().toISOString(),
      currentStockAtTime: finalStock
    };
    
    try {
      await setDoc(doc(db, 'transactions', id), newTransaction);
      setQuickMoveProduct(null);
    } catch (e) {
      console.error("Error adding transaction:", e);
    }
  };

  const addProduct = async (name: string, unit: string) => {
    const id = crypto.randomUUID();
    const newProduct: Product = { id, name, unit, initialStock: 0 };
    try {
      await setDoc(doc(db, 'products', id), newProduct);
    } catch (e) {
      console.error("Error adding product:", e);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Cela supprimera aussi l\'historique lié à ce produit. Continuer ?')) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      // Cleanup transactions for this product
      const relatedTx = transactions.filter(t => t.productId === id);
      for (const tx of relatedTx) {
        await deleteDoc(doc(db, 'transactions', tx.id));
      }
    } catch (e) {
      console.error("Error deleting product:", e);
    }
  };

  const filteredInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleLogout = () => {
    localStorage.removeItem('ppn_auth');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => {
      localStorage.setItem('ppn_auth', 'true');
      setIsAuthenticated(true);
    }} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em]">Chargement Synchro...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden relative print:hidden">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 w-full h-16 bg-slate-900 z-50 flex items-center justify-between px-6 shadow-xl border-b border-white/5">
         <h1 className="text-xl font-bold tracking-tight text-blue-400">
            PPN<span className="text-red-500 text-xs">Manager</span>
          </h1>
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-white bg-slate-800 rounded-lg"
          >
            <Menu size={20} />
          </button>
      </header>
      {/* Sidebar Navigation - Responsive */}
      <AnimatePresence>
        {(isSidebarOpen || window.innerWidth >= 1024) && (
          <motion.aside 
            initial={window.innerWidth < 1024 ? { x: -300 } : false}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className={`fixed inset-y-0 left-0 lg:static w-64 bg-slate-900 text-white flex flex-col shrink-0 z-50 shadow-2xl lg:shadow-none`}
          >
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-blue-400">
                  PPN<span className="text-red-500">Manager</span>
                </h1>
                <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-semibold">Stock Mobile Cloud</p>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1 text-slate-500">
                <X size={20} />
              </button>
            </div>
            
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
              <SidebarItem 
                icon={<LayoutDashboard size={18} />} 
                label="Dashboard" 
                active={activeTab === 'dashboard'} 
                onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }} 
              />
              <SidebarItem 
                icon={<Settings size={18} />} 
                label="Nos Produits" 
                active={activeTab === 'setup'} 
                onClick={() => { setActiveTab('setup'); setIsSidebarOpen(false); }} 
              />
              <div className="pt-4 pb-2 border-t border-slate-800/50 mt-4">
                 <SidebarItem 
                  icon={<History size={18} />} 
                  label="Historique" 
                  active={activeTab === 'history'} 
                  onClick={() => { setActiveTab('history'); setIsSidebarOpen(false); }} 
                />
              </div>
            </nav>

            <div className="p-4 border-t border-slate-800 space-y-4">
              <div className="p-3 bg-slate-800/50 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase italic">Cloud Live</span>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 p-3 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-500 transition-all font-bold text-xs uppercase tracking-widest"
              >
                <X size={16} />
                <span>Déconnexion</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden p-4 md:p-8 pt-20 lg:pt-8 transition-all">
        
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col h-full overflow-hidden"
            >
              {/* Header Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8 shrink-0">
                <StatBox label="Catalogue" value={products.length.toString()} />
                <StatBox 
                  label="Stock Restant" 
                  value={inventory.reduce((sum, item) => sum + item.currentStock, 0).toLocaleString()} 
                  color="text-blue-600"
                />
                <StatBox 
                  label="Toutes Sorties" 
                  value={transactions.filter(t => t.type === 'OUT').reduce((s, t) => s + t.quantity, 0).toLocaleString()} 
                  color="text-red-500"
                />
                <StatBox 
                  label="Produits en Stock" 
                  value={inventory.filter(item => item.currentStock > 0).length.toString()} 
                  color="text-emerald-600"
                />
              </div>

              {/* Inventory Table */}
              <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 md:p-5 border-b border-slate-100 flex flex-col md:row items-stretch md:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    <h2 className="font-black text-slate-800 uppercase text-[10px] md:text-sm tracking-tight shrink-0">État Actuel</h2>
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input 
                        type="text" 
                        placeholder="Rechercher..." 
                        className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase sticky top-0 z-10 border-b border-slate-100">
                      <tr>
                        <th className="px-4 md:px-6 py-4 font-black">Article</th>
                        <th className="px-4 md:px-6 py-4 font-black text-right">Reste</th>
                        <th className="hidden md:table-cell px-6 py-4 font-black text-center">Statut</th>
                        <th className="px-4 md:px-6 py-4 font-black text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 md:px-6 py-4">
                            <span className="font-black text-slate-800 text-sm md:text-lg tracking-tight uppercase leading-tight">{item.name}</span>
                            <span className="block text-[9px] text-slate-400 font-bold uppercase">{item.unit}</span>
                          </td>
                          <td className="px-4 md:px-6 py-4 text-right">
                            <span className={`text-xl md:text-2xl font-black tracking-tighter ${item.currentStock < 10 ? 'text-red-500' : 'text-slate-900'}`}>
                              {item.currentStock.toLocaleString()}
                            </span>
                          </td>
                          <td className="hidden md:table-cell px-6 py-4">
                            <div className="flex items-center justify-center gap-1.5">
                              {item.currentStock < 10 ? (
                                <div className="px-2 py-1 bg-red-100 text-red-600 rounded text-[9px] font-black uppercase ring-1 ring-red-200">Avertissement</div>
                              ) : (
                                <div className="px-2 py-1 bg-emerald-100 text-emerald-600 rounded text-[9px] font-black uppercase ring-1 ring-emerald-200">Sain</div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 md:px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5 md:gap-2">
                              <button 
                                onClick={() => setQuickMoveProduct({ id: item.id, name: item.name, type: 'IN', currentStock: item.currentStock })}
                                className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-blue-50 text-blue-600 rounded-lg md:rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                              >
                                <Plus size={18} strokeWidth={3} />
                              </button>
                              <button 
                                onClick={() => setQuickMoveProduct({ id: item.id, name: item.name, type: 'OUT', currentStock: item.currentStock })}
                                className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-red-50 text-red-500 rounded-lg md:rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-sm"
                              >
                                <Plus size={18} strokeWidth={3} className="rotate-45" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'setup' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col h-full overflow-hidden"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full overflow-hidden">
                {/* Product Form */}
                <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6 space-y-6 shrink-0 h-fit lg:h-full flex flex-col">
                  <h2 className="font-black text-[10px] md:text-sm uppercase tracking-widest text-slate-400">Nouveau Produit</h2>
                  <form className="space-y-4" onSubmit={async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const name = formData.get('name') as string;
                    const unit = formData.get('unit') as string;
                    if (name && unit) {
                      await addProduct(name, unit);
                      e.currentTarget.reset();
                    }
                  }}>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase text-slate-500">Nom du produit</label>
                      <input name="name" required placeholder="Ex: Biscuit, Savon..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase text-slate-500">Unité</label>
                      <select name="unit" required className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none cursor-pointer">
                        <option value="kg">kg</option>
                        <option value="pcs">pièces</option>
                        <option value="L">litres</option>
                        <option value="carton">carton</option>
                        <option value="gony">gony</option>
                        <option value="paquet">paquet</option>
                        <option value="bidon">bidon</option>
                        <option value="sachet">sachet</option>
                      </select>
                    </div>
                    <button type="submit" className="w-full py-4 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition-all uppercase text-[10px] tracking-widest shadow-lg shadow-blue-100 mt-2">
                       Ajouter au Catalogue
                    </button>
                  </form>
                </div>

                {/* Product List */}
                <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden min-h-0 relative">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 sticky top-0 z-10">
                    <h3 className="font-black text-[10px] uppercase text-slate-800 tracking-widest">Base de Données Articles</h3>
                    <span className="px-2 py-1 bg-slate-900 text-white rounded text-[8px] font-black uppercase">{products.length} ARTICLES</span>
                  </div>
                  <div className="flex-1 overflow-auto divide-y divide-slate-100">
                    {products.map(p => (
                      <div key={p.id} className="p-4 flex items-center justify-between hover:bg-slate-50 group">
                        <div className="flex items-center gap-3 md:gap-4 leading-tight">
                          <div className="w-8 h-8 md:w-10 md:h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all">
                            <Package size={18} />
                          </div>
                          <div>
                            <div className="font-black text-slate-800 uppercase text-xs md:text-sm tracking-tight">{p.name}</div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase">Unit: {p.unit}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => deleteProduct(p.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col h-full overflow-hidden"
            >
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
                <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="font-black text-[10px] md:text-sm uppercase text-slate-800 tracking-widest shrink-0">Mouvements & Temps Réel</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 md:w-48 min-w-[150px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                      <input 
                        type="text" 
                        placeholder="Chercher produit..." 
                        value={historySearchTerm}
                        onChange={(e) => setHistorySearchTerm(e.target.value)}
                        className="w-full pl-8 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-[9px] font-bold outline-none focus:border-blue-500/20 transition-all placeholder:text-slate-300"
                      />
                    </div>
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                      {(['all', 'day', 'week', 'month', 'custom'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setHistoryFilter(f)}
                          className={`px-2 py-1 text-[8px] font-black uppercase rounded-md transition-all ${
                            historyFilter === f ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          {f === 'all' ? 'Tout' : f === 'day' ? 'Jour' : f === 'week' ? 'Semaine' : f === 'month' ? 'Mois' : 'Calendrier'}
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={handlePrint}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[9px] font-black uppercase hover:bg-slate-800 transition-all shadow-sm"
                    >
                      <Printer size={14} />
                      <span>Imprimer</span>
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {historyFilter === 'custom' && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 md:px-6 pb-4 border-b border-slate-50 flex items-center gap-3 overflow-hidden"
                    >
                      <div className="flex flex-col gap-1">
                        <label className="text-[8px] font-black text-slate-400 uppercase">Début</label>
                        <input 
                          type="date" 
                          value={historyStartDate}
                          onChange={(e) => setHistoryStartDate(e.target.value)}
                          className="p-2 bg-slate-50 border border-slate-100 rounded-lg text-[9px] font-black uppercase outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[8px] font-black text-slate-400 uppercase">Fin</label>
                        <input 
                          type="date" 
                          value={historyEndDate}
                          onChange={(e) => setHistoryEndDate(e.target.value)}
                          className="p-2 bg-slate-50 border border-slate-100 rounded-lg text-[9px] font-black uppercase outline-none"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-400 text-[9px] uppercase sticky top-0 z-20 border-b border-slate-100">
                      <tr>
                        <th className="px-4 md:px-6 py-3 font-black">Date / Heure</th>
                        <th className="px-4 md:px-6 py-3 font-black">Produit</th>
                        <th className="px-4 md:px-6 py-3 font-black text-right">Qty</th>
                        <th className="px-4 md:px-6 py-3 font-black text-right bg-slate-100/50">Restant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTransactions.map(t => {
                        const prod = products.find(p => p.id === t.productId);
                        return (
                          <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 md:px-6 py-3 leading-none">
                              <div className="text-[10px] font-black text-slate-500 font-mono italic">
                                {new Date(t.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">
                                {new Date(t.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                              </div>
                            </td>
                            <td className="px-4 md:px-6 py-3">
                               <div className="font-black text-slate-800 uppercase text-[11px] tracking-tight truncate max-w-[80px] md:max-w-none">{prod?.name || 'Inconnu'}</div>
                               <div className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded w-fit mt-0.5 ${t.type === 'IN' ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-500'}`}>
                                  {t.type === 'IN' ? 'Entrée' : 'Sortie'}
                                </div>
                            </td>
                            <td className={`px-4 md:px-6 py-3 text-right font-black tabular-nums ${t.type === 'IN' ? 'text-blue-500' : 'text-red-400'}`}>
                              {t.type === 'IN' ? '+' : '-'}{t.quantity}
                            </td>
                            <td className="px-4 md:px-6 py-3 text-right bg-slate-50/30">
                               <span className="px-2 py-1 bg-slate-900 text-white rounded text-[11px] font-black tabular-nums shadow-sm">
                                  {t.currentStockAtTime.toLocaleString()}
                               </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Transaction Modal */}
        <AnimatePresence>
          {quickMoveProduct && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setQuickMoveProduct(null)}
                className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 30 }}
                className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-6 md:p-10 shadow-2xl border-b-[12px]"
                style={{ borderColor: quickMoveProduct.type === 'IN' ? '#3B82F6' : '#EF4444' }}
              >
                <div className="text-center space-y-6">
                  <div className={`mx-auto w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg ${quickMoveProduct.type === 'IN' ? 'bg-blue-600 text-white rotate-12 shadow-blue-200' : 'bg-red-500 text-white -rotate-12 shadow-red-200'}`}>
                    {quickMoveProduct.type === 'IN' ? <ArrowUpRight size={40} /> : <ArrowDownLeft size={40} />}
                  </div>
                  <div>
                    <h3 className="font-black text-3xl uppercase tracking-tighter text-slate-900 leading-tight">{quickMoveProduct.name}</h3>
                    <div className="inline-block px-3 py-1 bg-slate-50 rounded-full mt-2">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Action: {quickMoveProduct.type === 'IN' ? 'Arrivée' : 'Déstockage'}
                      </span>
                    </div>
                  </div>

                  <form className="space-y-6" onSubmit={async (e) => {
                    e.preventDefault();
                    const qty = Number(new FormData(e.currentTarget).get('qty'));
                    await addTransaction(quickMoveProduct.id, quickMoveProduct.type, qty, quickMoveProduct.currentStock);
                  }}>
                    <div className="space-y-2">
                      <input 
                        name="qty"
                        type="number" 
                        autoFocus
                        step="0.01"
                        required
                        placeholder="0.00" 
                        className="w-full text-center py-6 bg-slate-50 border-2 border-slate-100 rounded-3xl font-black text-4xl outline-none focus:border-slate-300 transition-all font-mono placeholder:text-slate-200"
                      />
                    </div>
                    <button 
                      type="submit" 
                      className={`w-full py-5 rounded-3xl font-black text-lg text-white shadow-xl transition-transform active:scale-95 ${
                        quickMoveProduct.type === 'IN' ? 'bg-blue-600 shadow-blue-500/20' : 'bg-red-500 shadow-red-500/20'
                      }`}
                    >
                      CONFIRMER
                    </button>
                    <button 
                      type="button"
                      onClick={() => setQuickMoveProduct(null)}
                      className="w-full text-[10px] font-black text-slate-300 hover:text-slate-500 uppercase tracking-widest transition-colors"
                    >
                      Annuler la saisie
                    </button>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Hidden Print-only View */}
      <div className="hidden print:block fixed inset-0 bg-white z-[999] p-8 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex justify-between items-end border-b-4 border-slate-900 pb-4">
            <div>
              <h1 className="text-4xl font-black uppercase tracking-tighter italic">Historique PPN</h1>
              <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mt-1">Export Categorisé par Produit</p>
            </div>
            <div className="text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Généré le {new Date().toLocaleDateString('fr-FR')} à {new Date().toLocaleTimeString('fr-FR')}
            </div>
          </div>

          <div className="space-y-12">
            {Object.entries(transactionsByProduct).map(([prodName, prodTransactions]) => {
              const typedTransactions = prodTransactions as Transaction[];
              return (
                <div key={prodName} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-6 bg-slate-900"></div>
                    <h2 className="text-xl font-black uppercase tracking-tight">{prodName}</h2>
                  </div>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-200">
                        <th className="py-2 font-black uppercase tracking-widest text-[9px] text-slate-400">Date & Heure</th>
                        <th className="py-2 font-black uppercase tracking-widest text-[9px] text-slate-400">Action</th>
                        <th className="py-2 font-black uppercase tracking-widest text-[9px] text-slate-400 text-right">Quantité</th>
                        <th className="py-2 font-black uppercase tracking-widest text-[9px] text-slate-400 text-right">Solde</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {typedTransactions.map(t => (
                        <tr key={t.id}>
                          <td className="py-2 font-mono">
                            {new Date(t.timestamp).toLocaleDateString('fr-FR')} {new Date(t.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className={`py-2 font-black uppercase tracking-tighter ${t.type === 'IN' ? 'text-blue-600' : 'text-red-600'}`}>
                            {t.type === 'IN' ? 'Entrée' : 'Sortie'}
                          </td>
                          <td className="py-2 text-right font-bold underline decoration-2 underline-offset-2">
                            {t.type === 'IN' ? '+' : '-'}{t.quantity}
                          </td>
                          <td className="py-2 text-right font-black">
                            {t.currentStockAtTime}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          <div className="pt-8 border-t border-slate-100 text-[8px] font-bold text-slate-300 uppercase tracking-widest text-center">
            Fin du rapport - PPN Manager Cloud System
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { 
  icon: ReactNode, 
  label: string, 
  active: boolean, 
  onClick: () => void 
}) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-black text-xs uppercase tracking-tight ${
        active 
          ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/30' 
          : 'text-slate-500 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <div className={`${active ? 'text-white' : 'text-slate-600'}`}>{icon}</div>
      <span>{label}</span>
      {active && (
        <motion.div 
          layoutId="sidebarActive" 
          className="ml-auto w-2 h-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]" 
        />
      )}
    </button>
  );
}

function StatBox({ label, value, color = 'text-slate-900' }: { label: string, value: string, color?: string }) {
  return (
    <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
      <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest">{label}</p>
      <p className={`text-xl md:text-2xl font-black mt-1 tracking-tighter ${color} tabular-nums`}>{value}</p>
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
      onLogin();
    } else {
      setError('Identifiants incorrects');
      setTimeout(() => setError(''), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Decorative Background Elements */}
      <div className="absolute top-0 -left-1/4 w-1/2 h-full bg-blue-600/10 blur-[120px] rounded-full rotate-12"></div>
      <div className="absolute bottom-0 -right-1/4 w-1/2 h-full bg-red-500/10 blur-[120px] rounded-full -rotate-12"></div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 shadow-2xl border-4 border-slate-900">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-slate-900 rounded-3xl mb-6 shadow-xl shadow-slate-200">
              <Lock className="text-blue-400" size={32} />
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-slate-900 uppercase">
              PPN<span className="text-red-500">Manager</span>
            </h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Accès Sécurisé • V2 Cloud</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 ml-4">Utilisateur</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="Nom d'utilisateur"
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-blue-500/20 transition-all placeholder:text-slate-200"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 ml-4">Mot de passe</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-blue-500/20 transition-all placeholder:text-slate-200"
                />
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-3 bg-red-50 text-red-500 rounded-xl flex items-center justify-center gap-2 text-[10px] font-black uppercase"
                >
                  <AlertCircle size={14} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              type="submit" 
              className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-slate-200 hover:bg-black transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
            >
              <LogIn size={18} />
              Se Connecter
            </button>
          </form>

          <div className="mt-10 pt-8 border-t border-slate-100 text-center">
             <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest leading-relaxed">
              Système de gestion privée.<br/>Accès restreint à l'administrateur.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
