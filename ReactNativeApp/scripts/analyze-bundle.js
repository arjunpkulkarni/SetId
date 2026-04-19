/**
 * Simple bundle analysis script for React Native
 * Run with: node scripts/analyze-bundle.js
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const excludePatterns = ['node_modules', '.git', 'android', 'ios'];

function analyzeImports(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const imports = content.match(/import.*from\s+['"][^'"]+['"]/g) || [];
    const requires = content.match(/require\(['"][^'"]+['"]\)/g) || [];
    
    return [...imports, ...requires].map(imp => {
      const match = imp.match(/['"]([^'"]+)['"]/);
      return match ? match[1] : null;
    }).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function findJSFiles(dir) {
  const files = [];
  
  function traverse(currentDir) {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      if (excludePatterns.some(pattern => item.includes(pattern))) continue;
      
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        traverse(fullPath);
      } else if (item.match(/\.(js|jsx|ts|tsx)$/)) {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return files;
}

function analyzeBundle() {
  console.log('🔍 Analyzing React Native bundle...\n');
  
  const files = findJSFiles(srcDir);
  const importCounts = {};
  const largeFiles = [];
  
  for (const file of files) {
    const size = fs.statSync(file).size;
    const relativePath = path.relative(srcDir, file);
    
    // Track large files
    if (size > 10000) { // 10KB
      largeFiles.push({ file: relativePath, size: Math.round(size / 1024) });
    }
    
    // Analyze imports
    const imports = analyzeImports(file);
    for (const imp of imports) {
      importCounts[imp] = (importCounts[imp] || 0) + 1;
    }
  }
  
  // Sort and display results
  const sortedImports = Object.entries(importCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
    
  const sortedLargeFiles = largeFiles
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);
  
  console.log('📦 Most frequently imported modules:');
  sortedImports.forEach(([module, count]) => {
    const emoji = module.startsWith('.') ? '📄' : 
                 module.includes('react') ? '⚛️' : 
                 module.includes('native') ? '📱' : '📚';
    console.log(`  ${emoji} ${module}: ${count} times`);
  });
  
  console.log('\n📏 Largest files (>10KB):');
  if (sortedLargeFiles.length === 0) {
    console.log('  ✅ No files larger than 10KB found!');
  } else {
    sortedLargeFiles.forEach(({ file, size }) => {
      console.log(`  📄 ${file}: ${size}KB`);
    });
  }
  
  console.log('\n💡 Optimization suggestions:');
  console.log('  • Consider lazy loading for screens with large dependencies');
  console.log('  • Use tree-shaking for libraries like lodash');
  console.log('  • Split large components into smaller ones');
  console.log('  • Use React.memo() for expensive components');
  
  const potentialOptimizations = sortedImports
    .filter(([module]) => module.includes('react-native') || module.includes('@expo'))
    .slice(0, 3);
    
  if (potentialOptimizations.length > 0) {
    console.log('\n🎯 Potential bundle size optimizations:');
    potentialOptimizations.forEach(([module, count]) => {
      console.log(`  • Review usage of '${module}' (imported ${count} times)`);
    });
  }
}

analyzeBundle();