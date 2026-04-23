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
  ChevronDown,
  Pencil
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
  writeBatch,
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
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

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
      
      const totalInTransactions = prodTransactions
        .filter(t => t.type === 'IN')
        .reduce((sum, t) => sum + t.quantity, 0);
      const totalOut = prodTransactions
        .filter(t => t.type === 'OUT')
        .reduce((sum, t) => sum + t.quantity, 0);
      
      // User requested that Entry (totalIn) and Stock (currentStock) always match
      const stockValue = prod.initialStock + totalInTransactions - totalOut;
      
      return {
        ...prod,
        totalIn: stockValue,
        totalOut,
        currentStock: stockValue
      };
    });
  }, [products, transactions]);

  const stats = useMemo(() => {
    const totalIn = inventory.reduce((sum, item) => sum + item.totalIn, 0);
    const totalOut = inventory.reduce((sum, item) => sum + item.totalOut, 0);
    const totalStock = inventory.reduce((sum, item) => sum + item.currentStock, 0);
    return { totalIn, totalOut, totalStock };
  }, [inventory]);

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

  const clearAllHistory = async () => {
    if (transactions.length === 0) {
      alert("L'historique est déjà vide.");
      return;
    }
    
    if (!window.confirm(`Voulez-vous vraiment archiver l'historique ? \n\nLes ${transactions.length} entrées seront effacées, mais vos niveaux de Stock actuels sur le Dashboard seront conservés.`)) return;
    
    setIsClearingHistory(true);
    try {
      // 1. Point de Restauration : Update initialStock for all products to preserve current levels
      const productBatch = writeBatch(db);
      inventory.forEach(item => {
        productBatch.update(doc(db, 'products', item.id), {
          initialStock: item.currentStock
        });
      });
      await productBatch.commit();

      // 2. Clear Transactions in batches
      const batchSize = 500;
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = transactions.slice(i, i + batchSize);
        chunk.forEach((tx) => {
          batch.delete(doc(db, 'transactions', tx.id));
        });
        await batch.commit();
      }
      
      alert("Historique effacé avec succès. Les niveaux de stock ont été préservés.");
    } catch (e) {
      console.error("Error clearing history:", e);
      alert("Une erreur est survenue lors de l'opération.");
    } finally {
      setIsClearingHistory(false);
    }
  };

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
    
    // Stock reduction on OUT, accumulation on IN
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

  const updateProduct = async (id: string, name: string, unit: string) => {
    const existing = products.find(p => p.id === id);
    try {
      await setDoc(doc(db, 'products', id), { 
        ...existing,
        name, 
        unit 
      }, { merge: true });
      setEditingProduct(null);
    } catch (e) {
      console.error("Error updating product:", e);
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
    <div className="flex h-screen w-full bg-slate-950 font-sans text-slate-100 overflow-hidden relative print:hidden tech-grid shadow-inner cursor-default">
      {/* Glow Effects */}
      <div className="absolute top-0 left-0 w-full h-[600px] bg-blue-600/5 blur-[120px] rounded-full -translate-y-1/2 pointer-events-none"></div>
      
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 w-full h-16 glass-panel z-50 flex items-center justify-between px-6 border-b border-white/5">
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
            className={`fixed inset-y-0 left-0 lg:static w-72 glass-panel text-white flex flex-col shrink-0 z-50 lg:border-r border-white/5`}
          >
            <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div>
                <h1 className="text-2xl font-black tracking-tighter text-blue-500 italic flex items-center gap-2">
                  PPN<span className="text-red-500 text-sm not-italic opacity-80">SYS</span>
                </h1>
                <p className="text-[9px] text-slate-500 mt-1 uppercase tracking-[0.3em] font-black">Centralized Stock DB</p>
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
                  <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Neural Link Active</span>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 p-4 rounded-2xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all font-black text-[10px] uppercase tracking-[0.2em] border border-white/5 bg-white/[0.02]"
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
              {/* Inventory Table */}
              <div className="flex-1 glass-panel rounded-3xl flex flex-col overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-white/5 flex flex-col md:flex-row items-stretch md:items-center gap-6 bg-white/[0.01]">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-1.5 h-6 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                    <h2 className="font-black text-white uppercase text-[10px] md:text-xs tracking-[0.2em] shrink-0">Terminal d'Inventaire</h2>
                    <div className="relative flex-1 max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                      <input 
                        type="text" 
                        placeholder="Scanner la base de données..." 
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-950/50 border border-white/5 rounded-xl text-[10px] uppercase font-black tracking-widest outline-none focus:border-blue-500/30 transition-all placeholder:text-slate-700"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-950 text-slate-500 text-[9px] uppercase sticky top-0 z-10 border-b border-white/5 font-black tracking-[0.2em]">
                      <tr>
                        <th className="px-6 py-5 text-left">Module Article</th>
                        <th className="px-6 py-5 text-right text-blue-400/80 group/th">
                          <div className="flex items-center justify-end gap-2">
                            <ArrowUpRight size={10} className="text-blue-500" />
                            <span>Entrée</span>
                          </div>
                        </th>
                        <th className="px-6 py-5 text-right text-red-400/80 group/th">
                           <div className="flex items-center justify-end gap-2">
                             <ArrowDownLeft size={10} className="text-red-500" />
                             <span>Sortie</span>
                           </div>
                        </th>
                        <th className="px-6 py-5 text-right">Stock Disponible</th>
                        <th className="px-6 py-5 text-right">Opérations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {filteredInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-blue-500/[0.02] transition-colors group">
                          <td className="px-6 py-5">
                            <span className="font-black text-slate-200 text-sm md:text-base tracking-tight uppercase leading-tight group-hover:text-blue-400 transition-colors">{item.name}</span>
                            <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mt-1">{item.unit || 'Standard'}</span>
                          </td>
                          <td className="px-6 py-5 text-right">
                             <span className="text-sm font-bold text-blue-500/80">
                              {item.totalIn.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                             <span className="text-sm font-bold text-red-500/80">
                              {item.totalOut.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="inline-flex flex-col items-end">
                              <span className={`text-xl font-black tracking-tighter ${item.currentStock < 10 ? 'text-red-500' : 'text-emerald-400'}`}>
                                {item.currentStock.toLocaleString()}
                              </span>
                              {item.currentStock < 10 && (
                                <span className="text-[7px] font-black text-red-500 animate-pulse mt-1">LOW_RESERVE</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => setQuickMoveProduct({ id: item.id, name: item.name, type: 'IN', currentStock: item.currentStock })}
                                className="w-10 h-10 flex items-center justify-center bg-blue-500/10 text-blue-400 rounded-xl hover:bg-blue-500 hover:text-white transition-all neon-glow-blue border border-blue-500/20"
                              >
                                <Plus size={18} strokeWidth={3} />
                              </button>
                              <button 
                                onClick={() => setQuickMoveProduct({ id: item.id, name: item.name, type: 'OUT', currentStock: item.currentStock })}
                                className="w-10 h-10 flex items-center justify-center bg-red-500/10 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-all neon-glow-red border border-blue-500/20"
                              >
                                <Plus size={18} strokeWidth={3} className="rotate-45" />
                              </button>
                              <div className="w-[1px] h-4 bg-white/5 mx-1 hidden md:block"></div>
                              <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => setEditingProduct(item)}
                                  className="p-2 text-slate-600 hover:text-white transition-all"
                                  title="Modifier"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button 
                                  onClick={() => deleteProduct(item.id)}
                                  className="p-2 text-slate-600 hover:text-red-500 transition-all"
                                  title="Supprimer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
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
                <div className="lg:col-span-4 glass-panel rounded-[2.5rem] p-8 md:p-10 space-y-8 shrink-0 h-fit lg:h-full flex flex-col border-t-8 border-blue-600 shadow-2xl">
                  <div className="space-y-1">
                    <h2 className="font-black text-xs md:text-sm uppercase tracking-[0.3em] text-white">Nouveau Module</h2>
                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Enregistrement dans le noyau</p>
                  </div>
                  <form className="space-y-6" onSubmit={async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const name = formData.get('name') as string;
                    const unit = formData.get('unit') as string;
                    if (name && unit) {
                      await addProduct(name, unit);
                      e.currentTarget.reset();
                    }
                  }}>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Nom de l'Article</label>
                       <input 
                        name="name" 
                        required 
                        placeholder="Ex: QUANTUM_CORE_01" 
                        className="w-full p-4 bg-slate-950 border border-white/5 rounded-2xl font-black text-sm outline-none focus:border-blue-500/30 transition-all placeholder:text-slate-800 text-white" 
                      />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Unité de Mesure</label>
                       <div className="relative">
                        <select 
                          name="unit" 
                          required 
                          className="w-full p-4 bg-slate-950 border border-white/5 rounded-2xl font-black text-sm outline-none cursor-pointer appearance-none text-blue-400"
                        >
                          <option value="kg">KILOGRAMMES (KG)</option>
                          <option value="pcs">PIÈCES (U)</option>
                          <option value="L">LITRES (L)</option>
                          <option value="carton">CARTONS (CTN)</option>
                          <option value="gony">GONY (SAC)</option>
                          <option value="paquet">PAQUETS (PKT)</option>
                          <option value="bidon">BIDONS (BD)</option>
                          <option value="sachet">SACHETS (SH)</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                       </div>
                    </div>
                    <button type="submit" className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all uppercase text-[11px] tracking-[0.2em] shadow-[0_0_20px_rgba(37,99,235,0.3)] mt-4">
                       Initialiser Article
                    </button>
                  </form>
                </div>

                {/* Product List */}
                <div className="lg:col-span-8 glass-panel rounded-[2.5rem] flex flex-col overflow-hidden min-h-0 relative shadow-2xl">
                  <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01] sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                      <h3 className="font-black text-xs uppercase text-white tracking-[0.2em]">Flux Catalogue Actif</h3>
                    </div>
                    <span className="px-3 py-1.5 bg-slate-950 text-blue-400 border border-blue-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest">{products.length} MODULES RÉPERTORIÉS</span>
                  </div>
                  <div className="flex-1 overflow-auto divide-y divide-white/5 px-4 pb-4">
                    {products.map(p => (
                      <div key={p.id} className="p-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors group rounded-2xl mt-2 border border-transparent hover:border-white/5">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-slate-950 border border-white/5 rounded-2xl flex items-center justify-center text-slate-500 group-hover:text-blue-400 transition-all group-hover:border-blue-500/30 group-hover:shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                            <Package size={20} />
                          </div>
                          <div>
                            <div className="font-black text-slate-100 uppercase text-xs md:text-sm tracking-tight group-hover:text-blue-400 transition-colors">{p.name}</div>
                            <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest mt-1 font-mono">CODE_REF: {p.id.split('-')[0].toUpperCase()} // UNIT: {p.unit}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setEditingProduct(p)}
                            className="p-3 text-slate-600 hover:text-white transition-all bg-white/[0.02] rounded-xl border border-white/5"
                            title="Modifier"
                          >
                            <Pencil size={14} />
                          </button>
                          <button 
                            onClick={() => deleteProduct(p.id)}
                            className="p-3 text-slate-600 hover:text-red-500 transition-all bg-white/[0.02] rounded-xl border border-white/5"
                            title="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
              <div className="glass-panel rounded-3xl flex flex-col h-full overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white/[0.01]">
                  <div className="flex items-center gap-4">
                    <div className="w-1.5 h-6 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    <h2 className="font-black text-[10px] md:text-xs uppercase text-white tracking-[0.2em] shrink-0">Flux Temporel des Données</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 md:w-56 min-w-[150px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={12} />
                      <input 
                        type="text" 
                        placeholder="Filtrer par module..." 
                        value={historySearchTerm}
                        onChange={(e) => setHistorySearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 bg-slate-950/50 border border-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none focus:border-blue-500/30 transition-all placeholder:text-slate-700"
                      />
                    </div>
                    <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
                      {(['all', 'day', 'week', 'month', 'custom'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setHistoryFilter(f)}
                          className={`px-3 py-1.5 text-[8px] font-black uppercase rounded-lg transition-all ${
                            historyFilter === f ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {f === 'all' ? 'Tout' : f === 'day' ? 'Jour' : f === 'week' ? 'Semaine' : f === 'month' ? 'Mois' : 'Calendrier'}
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={handlePrint}
                      className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.05] text-white border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/[0.1] transition-all"
                    >
                      <Printer size={14} />
                      <span>Exporter Rapport</span>
                    </button>
                    <button 
                      onClick={clearAllHistory}
                      disabled={isClearingHistory}
                      className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-[9px] font-black uppercase transition-all shadow-lg ${
                        isClearingHistory 
                          ? 'bg-slate-800 text-slate-500 border-white/10 cursor-not-allowed' 
                          : 'bg-red-600 text-white border-red-500 hover:bg-red-500 shadow-red-900/20'
                      }`}
                    >
                      {isClearingHistory ? (
                        <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Trash2 size={14} />
                      )}
                      <span>{isClearingHistory ? 'Suppression...' : 'Effacer Historique'}</span>
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {historyFilter === 'custom' && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-6 pb-4 border-b border-white/5 flex items-center gap-4 overflow-hidden bg-white/[0.01]"
                    >
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest">T0 (Start)</label>
                        <input 
                          type="date" 
                          value={historyStartDate}
                          onChange={(e) => setHistoryStartDate(e.target.value)}
                          className="p-2.5 bg-slate-950/80 border border-white/5 rounded-xl text-[9px] font-black uppercase outline-none text-blue-400"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest">T1 (End)</label>
                        <input 
                          type="date" 
                          value={historyEndDate}
                          onChange={(e) => setHistoryEndDate(e.target.value)}
                          className="p-2.5 bg-slate-950/80 border border-white/5 rounded-xl text-[9px] font-black uppercase outline-none text-blue-400"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-950 text-slate-500 text-[9px] uppercase sticky top-0 z-20 border-b border-white/5 font-black tracking-widest">
                      <tr>
                        <th className="px-6 py-4">Horodatage SyST</th>
                        <th className="px-6 py-4">Module Article</th>
                        <th className="px-6 py-4 text-right">Magnitude</th>
                        <th className="px-6 py-4 text-right bg-white/[0.01]">Vecteur Stock</th>
                        <th className="px-6 py-4 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {filteredTransactions.map(t => {
                        const prod = products.find(p => p.id === t.productId);
                        return (
                          <tr key={t.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="px-6 py-5 leading-none text-left">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/5 rounded-xl border border-white/5">
                                  <Clock size={16} className="text-blue-500 opacity-60" />
                                </div>
                                <div>
                                  <div className="text-sm font-black text-blue-400 mb-1 font-mono tracking-tight">
                                    {new Date(t.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                  <div className="text-[9px] text-slate-600 uppercase font-black tracking-[0.1em]">
                                    {new Date(t.timestamp).toLocaleDateString('fr-FR')}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className={`w-1 h-3 rounded-full ${t.type === 'IN' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`}></div>
                                <span className="font-black text-slate-200 text-xs md:text-sm tracking-tight uppercase">{prod?.name || 'Inconnu'}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className={`text-xs md:text-sm font-black tracking-tighter px-2 py-0.5 rounded ${t.type === 'IN' ? 'text-blue-400 bg-blue-500/5' : 'text-red-400 bg-red-500/5'}`}>
                                {t.type === 'IN' ? '+' : '-'}{t.quantity.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right bg-white/[0.01]">
                              <span className="text-xs md:text-base font-black text-slate-400 tracking-tighter">
                                {t.currentStockAtTime.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={async () => {
                                  if (window.confirm('Supprimer cette transaction ?')) {
                                    try {
                                      await deleteDoc(doc(db, 'transactions', t.id));
                                    } catch (e) {
                                      console.error("Error deleting transaction:", e);
                                      alert("Erreur lors de la suppression.");
                                    }
                                  }
                                }}
                                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                                title="Supprimer la transaction"
                              >
                                <Trash2 size={14} />
                              </button>
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
                  <div className={`mx-auto w-24 h-24 rounded-[2rem] flex items-center justify-center border-t-4 border-white/10 ${quickMoveProduct.type === 'IN' ? 'bg-blue-600/20 text-blue-400 rotate-12 neon-glow-blue' : 'bg-red-600/20 text-red-400 -rotate-12 neon-glow-red'}`}>
                    {quickMoveProduct.type === 'IN' ? <ArrowUpRight size={48} strokeWidth={3} /> : <ArrowDownLeft size={48} strokeWidth={3} />}
                  </div>
                  <div>
                    <h3 className="font-black text-3xl uppercase tracking-tighter text-white leading-tight">{quickMoveProduct.name}</h3>
                    <div className="inline-block px-4 py-1.5 bg-white/[0.03] border border-white/5 rounded-full mt-3">
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">
                        Flux Procédural: {quickMoveProduct.type === 'IN' ? 'Entrant' : 'Sortant'}
                      </span>
                    </div>
                  </div>

                  <form className="space-y-8" onSubmit={async (e) => {
                    e.preventDefault();
                    const qty = Number(new FormData(e.currentTarget).get('qty'));
                    await addTransaction(quickMoveProduct.id, quickMoveProduct.type, qty, quickMoveProduct.currentStock);
                  }}>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Valeur Numérique</label>
                      <input 
                        name="qty"
                        type="number" 
                        autoFocus
                        step="0.01"
                        required
                        placeholder="0.00" 
                        className="w-full text-center py-8 bg-slate-950 border-2 border-white/5 rounded-3xl font-black text-5xl outline-none focus:border-blue-500/30 transition-all font-mono placeholder:text-slate-900 text-white scanline"
                      />
                    </div>
                    <div className="pt-4 space-y-4">
                      <button 
                        type="submit" 
                        className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] text-white transition-all active:scale-95 ${
                          quickMoveProduct.type === 'IN' 
                            ? 'bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:bg-blue-500' 
                            : 'bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.4)] hover:bg-red-500'
                        }`}
                      >
                        Exécuter la Transaction
                      </button>
                      <button 
                        type="button"
                        onClick={() => setQuickMoveProduct(null)}
                        className="w-full text-[10px] font-black text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors"
                      >
                        Abandonner l'Opération
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Product Modal */}
        <AnimatePresence>
          {editingProduct && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingProduct(null)}
                className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 30 }}
                className="relative w-full max-w-sm glass-panel rounded-[2.5rem] p-8 md:p-10 shadow-3xl border-t-8 border-blue-600"
              >
                <div className="space-y-8">
                  <div className="text-center">
                    <h3 className="font-black text-2xl uppercase tracking-tighter text-white leading-tight">Configuration Module</h3>
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2">Réécriture des métadonnées</p>
                  </div>

                  <form className="space-y-6" onSubmit={async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    await updateProduct(editingProduct.id, formData.get('name') as string, formData.get('unit') as string);
                  }}>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase text-slate-400">Désignation</label>
                      <input 
                        name="name"
                        type="text" 
                        required 
                        defaultValue={editingProduct.name}
                        className="w-full p-4 bg-slate-950 border border-white/5 rounded-2xl font-black text-sm outline-none focus:border-blue-500/30 transition-all text-white placeholder:text-slate-800"
                      />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase text-slate-400">Vecteur d'Unité</label>
                      <select 
                        name="unit" 
                        required 
                        defaultValue={editingProduct.unit}
                        className="w-full p-4 bg-slate-950 border border-white/5 rounded-2xl font-black text-sm outline-none cursor-pointer text-blue-400 appearance-none"
                      >
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
                    <div className="pt-6 space-y-4">
                      <button 
                        type="submit" 
                        className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all uppercase text-[11px] tracking-[0.2em] shadow-[0_0_20px_rgba(37,99,235,0.3)]"
                      >
                        Appliquer Script
                      </button>
                      <button 
                        type="button"
                        onClick={() => setEditingProduct(null)}
                        className="w-full py-3 text-[10px] font-black text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors"
                      >
                        Révoquer
                      </button>
                    </div>
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
                        <th className="py-2 font-black uppercase tracking-widest text-[9px] text-slate-400 text-right">Stock</th>
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden font-sans tech-grid">
      {/* Dynamic Grid Background Overlay */}
      <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/5 via-transparent to-red-500/5 pointer-events-none"></div>
      <div className="absolute top-1/4 -left-64 w-[600px] h-[600px] bg-blue-600/10 blur-[150px] rounded-full animate-pulse pointer-events-none"></div>
      <div className="absolute bottom-1/4 -right-64 w-[600px] h-[600px] bg-red-600/10 blur-[150px] rounded-full animate-pulse pointer-events-none" style={{ animationDelay: '2s' }}></div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="glass-panel rounded-[3rem] p-10 md:p-14 shadow-3xl border-t-8 border-blue-600 relative overflow-hidden scanline">
          <div className="text-center mb-12 relative z-10">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-slate-950 border border-white/5 rounded-[2rem] mb-8 shadow-2xl neon-glow-blue rotate-3 hover:rotate-0 transition-transform duration-500">
              <Lock className="text-blue-500" size={40} />
            </div>
            <h1 className="text-4xl font-black tracking-tighter text-white italic">
              PPN<span className="text-red-500 opacity-80">SYS</span>
            </h1>
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.4em] mt-3">Auth Protocol Required</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
            <div className="space-y-2">
              <div className="flex justify-between items-center px-4">
                <label className="text-[9px] font-black uppercase text-slate-500 tracking-[0.2em]">Identification</label>
                <div className="text-[8px] font-mono text-slate-700">SRV_LINK_8080</div>
              </div>
              <div className="relative group">
                <User className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-500 transition-colors" size={18} />
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="ID_OPERATEUR"
                  className="w-full pl-14 pr-6 py-5 bg-slate-950 border border-white/5 rounded-2xl font-black text-sm outline-none focus:border-blue-500/20 transition-all placeholder:text-slate-800 text-white font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
               <div className="flex justify-between items-center px-4">
                <label className="text-[9px] font-black uppercase text-slate-500 tracking-[0.2em]">Clé de Chiffrement</label>
                <div className="text-[8px] font-mono text-slate-700">AES_256_ACTIVE</div>
              </div>
              <div className="relative group">
                <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-500 transition-colors" size={18} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-14 pr-6 py-5 bg-slate-950 border border-white/5 rounded-2xl font-black text-sm outline-none focus:border-blue-500/20 transition-all placeholder:text-slate-800 text-white font-mono"
                />
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-widest animate-shake"
                >
                  <AlertCircle size={16} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              type="submit" 
              className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-[0_0_25px_rgba(37,99,235,0.4)] hover:bg-blue-500 transition-all flex items-center justify-center gap-4 active:scale-[0.98] mt-4"
            >
              <LogIn size={20} strokeWidth={3} />
              Accéder au Noyau
            </button>
          </form>

          <footer className="mt-12 pt-10 border-t border-white/5 text-center">
             <p className="text-[8px] font-black text-slate-700 uppercase tracking-[0.3em] leading-relaxed">
              Propulsion Système Alpha v2.8<br/>
              <span className="text-slate-800">Sécurité Niveau 4 Activée</span>
            </p>
          </footer>
        </div>
      </motion.div>
    </div>
  );
}
