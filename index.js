// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = function(status, toThrow) {
  throw toThrow;
};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string';
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (Module['ENVIRONMENT']) {
  throw new Error('Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -s ENVIRONMENT=web or -s ENVIRONMENT=node)');
}



// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var read_,
    readAsync,
    readBinary,
    setWindowTitle;

var nodeFS;
var nodePath;

if (ENVIRONMENT_IS_NODE) {
  if (ENVIRONMENT_IS_WORKER) {
    scriptDirectory = require('path').dirname(scriptDirectory) + '/';
  } else {
    scriptDirectory = __dirname + '/';
  }


  read_ = function shell_read(filename, binary) {
    var ret = tryParseAsDataURI(filename);
    if (ret) {
      return binary ? ret : ret.toString();
    }
    if (!nodeFS) nodeFS = require('fs');
    if (!nodePath) nodePath = require('path');
    filename = nodePath['normalize'](filename);
    return nodeFS['readFileSync'](filename, binary ? null : 'utf8');
  };

  readBinary = function readBinary(filename) {
    var ret = read_(filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };




  if (process['argv'].length > 1) {
    thisProgram = process['argv'][1].replace(/\\/g, '/');
  }

  arguments_ = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  process['on']('unhandledRejection', abort);

  quit_ = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };



} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    read_ = function shell_read(f) {
      var data = tryParseAsDataURI(f);
      if (data) {
        return intArrayToString(data);
      }
      return read(f);
    };
  }

  readBinary = function readBinary(f) {
    var data;
    data = tryParseAsDataURI(f);
    if (data) {
      return data;
    }
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    arguments_ = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    arguments_ = arguments;
  }

  if (typeof quit === 'function') {
    quit_ = function(status) {
      quit(status);
    };
  }

  if (typeof print !== 'undefined') {
    // Prefer to use print/printErr where they exist, as they usually work better.
    if (typeof console === 'undefined') console = {};
    console.log = print;
    console.warn = console.error = typeof printErr !== 'undefined' ? printErr : print;
  }


} else

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  // Differentiate the Web Worker from the Node Worker case, as reading must
  // be done differently.
  {


  read_ = function shell_read(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    } catch (err) {
      var data = tryParseAsDataURI(url);
      if (data) {
        return intArrayToString(data);
      }
      throw err;
    }
  };

  if (ENVIRONMENT_IS_WORKER) {
    readBinary = function readBinary(url) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
      } catch (err) {
        var data = tryParseAsDataURI(url);
        if (data) {
          return data;
        }
        throw err;
      }
    };
  }

  readAsync = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      var data = tryParseAsDataURI(url);
      if (data) {
        onload(data.buffer);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };




  }

  setWindowTitle = function(title) { document.title = title };
} else
{
  throw new Error('environment detection error');
}


// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
var out = Module['print'] || console.log.bind(console);
var err = Module['printErr'] || console.warn.bind(console);

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module['arguments']) arguments_ = Module['arguments'];if (!Object.getOwnPropertyDescriptor(Module, 'arguments')) Object.defineProperty(Module, 'arguments', { configurable: true, get: function() { abort('Module.arguments has been replaced with plain arguments_') } });
if (Module['thisProgram']) thisProgram = Module['thisProgram'];if (!Object.getOwnPropertyDescriptor(Module, 'thisProgram')) Object.defineProperty(Module, 'thisProgram', { configurable: true, get: function() { abort('Module.thisProgram has been replaced with plain thisProgram') } });
if (Module['quit']) quit_ = Module['quit'];if (!Object.getOwnPropertyDescriptor(Module, 'quit')) Object.defineProperty(Module, 'quit', { configurable: true, get: function() { abort('Module.quit has been replaced with plain quit_') } });

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// Assertions on removed incoming Module JS APIs.
assert(typeof Module['memoryInitializerPrefixURL'] === 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['pthreadMainPrefixURL'] === 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['cdInitializerPrefixURL'] === 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['filePackagePrefixURL'] === 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['read'] === 'undefined', 'Module.read option was removed (modify read_ in JS)');
assert(typeof Module['readAsync'] === 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
assert(typeof Module['readBinary'] === 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
assert(typeof Module['setWindowTitle'] === 'undefined', 'Module.setWindowTitle option was removed (modify setWindowTitle in JS)');
if (!Object.getOwnPropertyDescriptor(Module, 'read')) Object.defineProperty(Module, 'read', { configurable: true, get: function() { abort('Module.read has been replaced with plain read_') } });
if (!Object.getOwnPropertyDescriptor(Module, 'readAsync')) Object.defineProperty(Module, 'readAsync', { configurable: true, get: function() { abort('Module.readAsync has been replaced with plain readAsync') } });
if (!Object.getOwnPropertyDescriptor(Module, 'readBinary')) Object.defineProperty(Module, 'readBinary', { configurable: true, get: function() { abort('Module.readBinary has been replaced with plain readBinary') } });
// TODO: add when SDL2 is fixed if (!Object.getOwnPropertyDescriptor(Module, 'setWindowTitle')) Object.defineProperty(Module, 'setWindowTitle', { configurable: true, get: function() { abort('Module.setWindowTitle has been replaced with plain setWindowTitle') } });
var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';


// TODO remove when SDL2 is fixed (also see above)



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;

// stack management, and other functionality that is provided by the compiled code,
// should not be used before it is ready
stackSave = stackRestore = stackAlloc = function() {
  abort('cannot use the stack before compiled code is ready to run, and has provided stack access');
};

function staticAlloc(size) {
  abort('staticAlloc is no longer available at runtime; instead, perform static allocations at compile time (using makeStaticAlloc)');
}

function dynamicAlloc(size) {
  assert(DYNAMICTOP_PTR);
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end > _emscripten_get_heap_size()) {
    abort('failure to dynamicAlloc - memory growth etc. is not supported there, call malloc/sbrk directly');
  }
  HEAP32[DYNAMICTOP_PTR>>2] = end;
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}






// Wraps a JS function as a wasm function with a given signature.
function convertJsFunctionToWasm(func, sig) {

  // If the type reflection proposal is available, use the new
  // "WebAssembly.Function" constructor.
  // Otherwise, construct a minimal wasm module importing the JS function and
  // re-exporting it.
  if (typeof WebAssembly.Function === "function") {
    var typeNames = {
      'i': 'i32',
      'j': 'i64',
      'f': 'f32',
      'd': 'f64'
    };
    var type = {
      parameters: [],
      results: sig[0] == 'v' ? [] : [typeNames[sig[0]]]
    };
    for (var i = 1; i < sig.length; ++i) {
      type.parameters.push(typeNames[sig[i]]);
    }
    return new WebAssembly.Function(type, func);
  }

  // The module is static, with the exception of the type section, which is
  // generated based on the signature passed in.
  var typeSection = [
    0x01, // id: section,
    0x00, // length: 0 (placeholder)
    0x01, // count: 1
    0x60, // form: func
  ];
  var sigRet = sig.slice(0, 1);
  var sigParam = sig.slice(1);
  var typeCodes = {
    'i': 0x7f, // i32
    'j': 0x7e, // i64
    'f': 0x7d, // f32
    'd': 0x7c, // f64
  };

  // Parameters, length + signatures
  typeSection.push(sigParam.length);
  for (var i = 0; i < sigParam.length; ++i) {
    typeSection.push(typeCodes[sigParam[i]]);
  }

  // Return values, length + signatures
  // With no multi-return in MVP, either 0 (void) or 1 (anything else)
  if (sigRet == 'v') {
    typeSection.push(0x00);
  } else {
    typeSection = typeSection.concat([0x01, typeCodes[sigRet]]);
  }

  // Write the overall length of the type section back into the section header
  // (excepting the 2 bytes for the section id and length)
  typeSection[1] = typeSection.length - 2;

  // Rest of the module is static
  var bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic ("\0asm")
    0x01, 0x00, 0x00, 0x00, // version: 1
  ].concat(typeSection, [
    0x02, 0x07, // import section
      // (import "e" "f" (func 0 (type 0)))
      0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
    0x07, 0x05, // export section
      // (export "f" (func 0 (type 0)))
      0x01, 0x01, 0x66, 0x00, 0x00,
  ]));

   // We can compile this wasm module synchronously because it is very small.
  // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
  var module = new WebAssembly.Module(bytes);
  var instance = new WebAssembly.Instance(module, {
    'e': {
      'f': func
    }
  });
  var wrappedFunc = instance.exports['f'];
  return wrappedFunc;
}

// Add a wasm function to the table.
function addFunctionWasm(func, sig) {
  var table = wasmTable;
  var ret = table.length;

  // Grow the table
  try {
    table.grow(1);
  } catch (err) {
    if (!(err instanceof RangeError)) {
      throw err;
    }
    throw 'Unable to grow wasm table. Use a higher value for RESERVED_FUNCTION_POINTERS or set ALLOW_TABLE_GROWTH.';
  }

  // Insert new element
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    table.set(ret, func);
  } catch (err) {
    if (!(err instanceof TypeError)) {
      throw err;
    }
    assert(typeof sig !== 'undefined', 'Missing signature argument to addFunction');
    var wrapped = convertJsFunctionToWasm(func, sig);
    table.set(ret, wrapped);
  }

  return ret;
}

function removeFunctionWasm(index) {
  // TODO(sbc): Look into implementing this to allow re-using of table slots
}

// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {
  assert(typeof func !== 'undefined');

  return addFunctionWasm(func, sig);
}

function removeFunction(index) {
  removeFunctionWasm(index);
}



var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    // j (64-bit integer) must be passed in as two numbers [low 32, high 32].
    assert(args.length === sig.substring(1).replace(/j/g, '--').length);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    assert(sig.length == 1);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
};

var getTempRet0 = function() {
  return tempRet0;
};

function getCompilerSetting(name) {
  throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for getCompilerSetting or emscripten_get_compiler_setting to work';
}

var Runtime = {
  // helpful errors
  getTempRet0: function() { abort('getTempRet0() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  staticAlloc: function() { abort('staticAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  stackAlloc: function() { abort('stackAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;




// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html


var wasmBinary;if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];if (!Object.getOwnPropertyDescriptor(Module, 'wasmBinary')) Object.defineProperty(Module, 'wasmBinary', { configurable: true, get: function() { abort('Module.wasmBinary has been replaced with plain wasmBinary') } });
var noExitRuntime;if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];if (!Object.getOwnPropertyDescriptor(Module, 'noExitRuntime')) Object.defineProperty(Module, 'noExitRuntime', { configurable: true, get: function() { abort('Module.noExitRuntime has been replaced with plain noExitRuntime') } });


if (typeof WebAssembly !== 'object') {
  abort('No WebAssembly support found. Build with -s WASM=0 to target JavaScript instead.');
}


// In MINIMAL_RUNTIME, setValue() and getValue() are only available when building with safe heap enabled, for heap safety checking.
// In traditional runtime, setValue() and getValue() are always available (although their use is highly discouraged due to perf penalties)

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}





// Wasm globals

var wasmMemory;

// In fastcomp asm.js, we don't need a wasm Table at all.
// In the wasm backend, we polyfill the WebAssembly object,
// so this creates a (non-native-wasm) table for us.
var wasmTable = new WebAssembly.Table({
  'initial': 10,
  'maximum': 10 + 0,
  'element': 'anyfunc'
});


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  assert(returnType !== 'array', 'Return type should not be "array".');
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);

  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, 'Must know what type to store in allocate!');

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}


// runtime_strings.js: Strings related runtime functions that are part of both MINIMAL_RUNTIME and regular runtime.

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u >= 0x200000) warnOnce('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}



// runtime_strings_extra.js: Strings related runtime functions that are available only in regular runtime.

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}

// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;

function UTF16ToString(ptr) {
  assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    assert(str.charCodeAt(i) === str.charCodeAt(i)&0xff);
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}



// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferAndViews(buf) {
  buffer = buf;
  Module['HEAP8'] = HEAP8 = new Int8Array(buf);
  Module['HEAP16'] = HEAP16 = new Int16Array(buf);
  Module['HEAP32'] = HEAP32 = new Int32Array(buf);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buf);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buf);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buf);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buf);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buf);
}

var STATIC_BASE = 1024,
    STACK_BASE = 5252608,
    STACKTOP = STACK_BASE,
    STACK_MAX = 9728,
    DYNAMIC_BASE = 5252608,
    DYNAMICTOP_PTR = 9568;

assert(STACK_BASE % 16 === 0, 'stack must start aligned');
assert(DYNAMIC_BASE % 16 === 0, 'heap must start aligned');



var TOTAL_STACK = 5242880;
if (Module['TOTAL_STACK']) assert(TOTAL_STACK === Module['TOTAL_STACK'], 'the stack size can no longer be determined at runtime')

var INITIAL_TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;if (!Object.getOwnPropertyDescriptor(Module, 'TOTAL_MEMORY')) Object.defineProperty(Module, 'TOTAL_MEMORY', { configurable: true, get: function() { abort('Module.TOTAL_MEMORY has been replaced with plain INITIAL_TOTAL_MEMORY') } });

assert(INITIAL_TOTAL_MEMORY >= TOTAL_STACK, 'TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + INITIAL_TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && Int32Array.prototype.subarray !== undefined && Int32Array.prototype.set !== undefined,
       'JS engine does not provide full typed array support');






// In standalone mode, the wasm creates the memory, and the user can't provide it.
// In non-standalone/normal mode, we create the memory here.

// Create the main memory. (Note: this isn't used in STANDALONE_WASM mode since the wasm
// memory is created in the wasm, not in JS.)

  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory'];
  } else
  {
    wasmMemory = new WebAssembly.Memory({
      'initial': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE
    });
  }


if (wasmMemory) {
  buffer = wasmMemory.buffer;
}

// If the user provides an incorrect length, just use that length instead rather than providing the user to
// specifically provide the memory length with Module['TOTAL_MEMORY'].
INITIAL_TOTAL_MEMORY = buffer.byteLength;
assert(INITIAL_TOTAL_MEMORY % WASM_PAGE_SIZE === 0);
updateGlobalBufferAndViews(buffer);

HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;




// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  // The stack grows downwards
  HEAPU32[(STACK_MAX >> 2)+1] = 0x2135467;
  HEAPU32[(STACK_MAX >> 2)+2] = 0x89BACDFE;
  // Also test the global address 0 for integrity.
  // We don't do this with ASan because ASan does its own checks for this.
  HEAP32[0] = 0x63736d65; /* 'emsc' */
}

function checkStackCookie() {
  var cookie1 = HEAPU32[(STACK_MAX >> 2)+1];
  var cookie2 = HEAPU32[(STACK_MAX >> 2)+2];
  if (cookie1 != 0x2135467 || cookie2 != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x2135467, but received 0x' + cookie2.toString(16) + ' ' + cookie1.toString(16));
  }
  // Also test the global address 0 for integrity.
  // We don't do this with ASan because ASan does its own checks for this.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
}

function abortStackOverflow(allocSize) {
  abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - stackSave() + allocSize) + ' bytes available!');
}




// Endianness check (note: assumes compiler arch was little-endian)
(function() {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';
})();

function abortFnPtrError(ptr, sig) {
	abort("Invalid function pointer " + ptr + " called with signature '" + sig + "'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this). Build with ASSERTIONS=2 for more info.");
}



function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {

  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  checkStackCookie();
  assert(!runtimeInitialized);
  runtimeInitialized = true;
  
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  checkStackCookie();
  
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  checkStackCookie();
  runtimeExited = true;
}

function postRun() {
  checkStackCookie();

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/fround

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/trunc

assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
  return id;
}

function addRunDependency(id) {
  runDependencies++;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(function() {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            err('still waiting on run dependencies:');
          }
          err('dependency: ' + dep);
        }
        if (shown) {
          err('(end of list)');
        }
      }, 10000);
    }
  } else {
    err('warning: run dependency added without ID');
  }
}

function removeRunDependency(id) {
  runDependencies--;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    err('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data


function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  what += '';
  out(what);
  err(what);

  ABORT = true;
  EXITSTATUS = 1;

  var output = 'abort(' + what + ') at ' + stackTrace();
  what = output;

  // Throw a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  throw new WebAssembly.RuntimeError(what);
}


var memoryInitializer = null;


// show errors on likely calls to FS when it was not included
var FS = {
  error: function() {
    abort('Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with  -s FORCE_FILESYSTEM=1');
  },
  init: function() { FS.error() },
  createDataFile: function() { FS.error() },
  createPreloadedFile: function() { FS.error() },
  createLazyFile: function() { FS.error() },
  open: function() { FS.error() },
  mkdev: function() { FS.error() },
  registerDevice: function() { FS.error() },
  analyzePath: function() { FS.error() },
  loadFilesFromDB: function() { FS.error() },

  ErrnoError: function ErrnoError() { FS.error() },
};
Module['FS_createDataFile'] = FS.createDataFile;
Module['FS_createPreloadedFile'] = FS.createPreloadedFile;



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'data:application/octet-stream;base64,AGFzbQEAAAAB/gEjYAF/AX9gAn9/AX9gA39/fwF/YAF/AGACf38AYAABf2ADf39/AGAEf39/fwF/YAV/f39/fwF/YAN/fn8BfmAAAGAEf39/fwBgBX9/f39/AGAGf3x/f39/AX9gAn9/AXxgA39/fwF8YAR/fn5/AGADf3x8AGACfn8Bf2AEf39/fwF8YAJ/fABgBH98f38AYAZ/fH9/f38AYAd/f39/f39/AX9gCn9/f39/f398f3wBf2AHf39/f3x/fwF/YAd/f3x/f39/AX9gBH9+f38Bf2ACf3wBf2ADfn9/AX9gBH9/fn8BfmABfAF+YAZ/f39/f38BfGACfn4BfGACfH8BfAKTAgwDZW52BGV4aXQAAwNlbnYGX19sb2NrAAMDZW52CF9fdW5sb2NrAAMWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhmZF9jbG9zZQAAFndhc2lfc25hcHNob3RfcHJldmlldzEIZmRfd3JpdGUABwNlbnYWZW1zY3JpcHRlbl9yZXNpemVfaGVhcAAAA2VudhVlbXNjcmlwdGVuX21lbWNweV9iaWcAAgNlbnYXX19oYW5kbGVfc3RhY2tfb3ZlcmZsb3cACgNlbnYLc2V0VGVtcFJldDAAAxZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxB2ZkX3NlZWsACANlbnYGbWVtb3J5AgCAAgNlbnYFdGFibGUBcAAKA5gBlgEFCgcLBwYGBgwEBAYFAwMDAQQCAAMCCAQEAwEBAgsEBAQAAQAYAQMEAQABAwEAAAAAAxQcAQECAQ8MDhUODxkGDhMTIBYPEREBAQAFBQEBAQAFCQEJAgAAAwACBQECIgUKAAIIFwYACwwSHRICDQQfAgcCAgAAAwACAAAAABAQIQADAQEBBAACAgQDBQADAAEHHhoGCBsGFQN/AUHgysACC38AQdTKAAt/AUEACweJAhIRX193YXNtX2NhbGxfY3RvcnMACwZmZmx1c2gAgwEEZnJlZQCLARBfX2Vycm5vX2xvY2F0aW9uAFUGbWFsbG9jAIoBBXN0YXJ0AC4Ic2V0VGhyZXcAkwEKX19kYXRhX2VuZAMBEV9fc2V0X3N0YWNrX2xpbWl0AJQBCXN0YWNrU2F2ZQCVAQpzdGFja0FsbG9jAJYBDHN0YWNrUmVzdG9yZQCXARBfX2dyb3dXYXNt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xwEgxwG2Ia8BIAcgrwE4AogBIAcgVTYChAFBACFiIGItAPQlIWNBGCFkIGMgZHQhZSBlIGR1IWYgZiFnIFQhaCBnIGhGIWlBASFqIGkganEhawJAIGtFDQAgBygChAEhbEEBIW0gbCBtaiFuIAcgbjYChAELIAcoAuwBIW8gBygChAEhcCAHKgKcASGwASCwAbshyAEgByoCmAEhsQEgsQG7IckBIAcqApQBIbIBILIBuyHKASAHKgKQASGzASCzAbshywEgByoCjAEhtAEgtAG7IcwBIAcqAogBIbUBILUBuyHNAUEoIXEgByBxaiFyIHIgzQE5AwBBICFzIAcgc2ohdCB0IMwBOQMAQRghdSAHIHVqIXYgdiDLATkDAEEQIXcgByB3aiF4IHggygE5AwAgByDJATkDCCAHIMgBOQMAIG8gcCAHEBUMAQtB4wAheUHmCyF6IAcgejYCgAFBACF7IHstAPQlIXxBGCF9IHwgfXQhfiB+IH11IX8gfyGAASB5IYEBIIABIIEBRiGCAUEBIYMBIIIBIIMBcSGEAQJAIIQBRQ0AIAcoAoABIYUBQQEhhgEghQEghgFqIYcBIAcghwE2AoABCyAHKALsASGIASAHKAKAASGJASAHKAK0ASGKASAHKAKwASGLASAHKAKsASGMASAHKAKoASGNASAHKAKkASGOASAHKAKgASGPAUHEACGQASAHIJABaiGRASCRASCPATYCAEHAACGSASAHIJIBaiGTASCTASCOATYCACAHII0BNgI8IAcgjAE2AjggByCLATYCNCAHIIoBNgIwQTAhlAEgByCUAWohlQEgiAEgiQEglQEQFQtB4wAhlgFB0AEhlwEgByCXAWohmAEgmAEhmQEgmQEpAgAhqQFBACGaASCaASCpATcC+CVBACGbASCbASCWAToA9CVB8AEhnAEgByCcAWohnQECQCCdASKfASMCSQRAEAcLIJ8BJAALDwupAwEyfyMAIQJBECEDIAIgA2shBAJAIAQiMiMCSQRAEAcLIDIkAAsgBCAANgIMIAQgATYCCCAEKAIIIQUgBRBUIQYgBCAGNgIEQQAhByAHKALoIiEIAkACQCAIDQBBywAhCUEAIQogCigC8CUhCyAEKAIEIQwgCyAMaiENQQEhDiANIA5qIQ8gDyEQIAkhESAQIBFKIRJBASETIBIgE3Eh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ICBqISEgGyAdIB8gIRBLIYYBIAgghgE5A5ACQQghIiABICJqISMgIykDACF2QfgAISQgCCAkaiElICUgImohJiAmIHY3AwAgASkDACF3IAggdzcDeCACICJqIScgJykDACF4QegAISggCCAoaiEpICkgImohKiAqIHg3AwAgAikDACF5IAggeTcDaCAEICJqISsgKykDACF6QdgAISwgCCAsaiEtIC0gImohLiAuIHo3AwAgBCkDACF7IAggezcDWCAFICJqIS8gLykDACF8QcgAITAgCCAwaiExIDEgImohMiAyIHw3AwAgBSkDACF9IAggfTcDSEH4ACEzIAggM2ohNEHoACE1IAggNWohNkHYACE3IAggN2ohOEHIACE5IAggOWohOiA0IDYgOCA6EEshhwEgCCCHATkDiAJBCCE7IAIgO2ohPCA8KQMAIX5BuAEhPSAIID1qIT4gPiA7aiE/ID8gfjcDACACKQMAIX8gCCB/NwO4ASADIDtqIUAgQCkDACGAAUGoASFBIAggQWohQiBCIDtqIUMgQyCAATcDACADKQMAIYEBIAgggQE3A6gBIAQgO2ohRCBEKQMAIYIBQZgBIUUgCCBFaiFGIEYgO2ohRyBHIIIBNwMAIAQpAwAhgwEgCCCDATcDmAEgBSA7aiFIIEgpAwAhhAFBiAEhSSAIIElqIUogSiA7aiFLIEsghAE3AwAgBSkDACGFASAIIIUBNwOIAUG4ASFMIAggTGohTUGoASFOIAggTmohT0GYASFQIAggUGohUUGIASFSIAggUmohUyBNIE8gUSBTEEshiAFBACFUIFS3IYkBRAAAAAAAABBAIYoBRAAAAAAAAABAIYsBIAggiAE5A4ACIAgrA5ACIYwBIAgrA4gCIY0BII0BII0BoCGOASCMASCOAaEhjwEgCCsDgAIhkAEgjwEgkAGgIZEBIAggkQE5A/gBIAgrA5ACIZIBIAgrA4gCIZMBIIsBIJMBoiGUASCSASCSAaAhlQEglAEglQGhIZYBIAgglgE5A/ABIAgrA5ACIZcBIAgglwE5A+gBIAgrA/ABIZgBIAgrA/ABIZkBIAgrA/gBIZoBIIoBIJoBoiGbASAIKwPoASGcASCbASCcAaIhnQEgnQGaIZ4BIJgBIJkBoiGfASCfASCeAaAhoAEgCCCgATkD4AEgCCsD+AEhoQEg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AgBBfwtTAQF+AkACQCADQcAAcUUNACACIANBQGqtiCEBQgAhAgwBCyADRQ0AIAJBwAAgA2uthiABIAOtIgSIhCEBIAIgBIghAgsgACABNwMAIAAgAjcDCAtTAQF+AkACQCADQcAAcUUNACABIANBQGqthiECQgAhAQwBCyADRQ0AIAFBwAAgA2utiCACIAOtIgSGhCECIAEgBIYhAQsgACABNwMAIAAgAjcDCAuIBAIEfwJ+AkAjAEEgayICIgQjAkkEQBAHCyAEJAALAkACQCABQv///////////wCDIgZCgICAgICAwP9DfCAGQoCAgICAgMCAvH98Wg0AIABCPIggAUIEhoQhBgJAIABC//////////8PgyIAQoGAgICAgICACFQNACAGQoGAgICAgICAwAB8IQcMAgsgBkKAgICAgICAgMAAfCEHIABCgICAgICAgIAIhUIAUg0BIAdCAYMgB3whBwwBCwJAIABQIAZCgICAgICAwP//AFQgBkKAgICAgIDA//8AURsNACAAQjyIIAFCBIaEQv////////8Dg0KAgICAgICA/P8AhCEHDAELQoCAgICAgID4/wAhByAGQv///////7//wwBWDQBCACEHIAZCMIinIgNBkfcASQ0AIAIgACABQv///////z+DQoCAgICAgMAAhCIGQYH4ACADaxCHASACQRBqIAAgBiADQf+If2oQiAEgAikDACIGQjyIIAJBCGopAwBCBIaEIQcCQCAGQv//////////D4MgAikDECACQRBqQQhqKQMAhEIAUq2EIgZCgYCAgICAgIAIVA0AIAdCAXwhBwwBCyAGQoCAgICAgICACIVCAFINACAHQgGDIAd8IQcLAkAgAkEgaiIFIwJJBEAQBwsgBSQACyAHIAFCgICAgICAgICAf4OEvwupMAENfwJAIwBBEGsiASIMIwJJBEAQBwsgDCQACwJAAkACQAJAAkACQAJAAkACQAJAAkACQCAAQfQBSw0AAkBBACgC3EYiAkEQIABBC2pBeHEgAEELSRsiA0EDdiIEdiIAQQNxRQ0AIABBf3NBAXEgBGoiA0EDdCIFQYzHAGooAgAiBEEIaiEAAkACQCAEKAIIIgYgBUGExwBqIgVHDQBBACACQX4gA3dxNgLcRgwBC0EAKALsRiAGSxogBiAFNgIMIAUgBjYCCAsgBCAD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DQAgACABIAIQBhogAA8LIAAgAmohAwJAAkAgASAAc0EDcQ0AAkACQCACQQFODQAgACECDAELAkAgAEEDcQ0AIAAhAgwBCyAAIQIDQCACIAEtAAA6AAAgAUEBaiEBIAJBAWoiAiADTw0BIAJBA3ENAAsLAkAgA0F8cSIEQcAASQ0AIAIgBEFAaiIFSw0AA0AgAiABKAIANgIAIAIgASgCBDYCBCACIAEoAgg2AgggAiABKAIMNgIMIAIgASgCEDYCECACIAEoAhQ2AhQgAiABKAIYNgIYIAIgASgCHDYCHCACIAEoAiA2AiAgAiABKAIkNgIkIAIgASgCKDYCKCACIAEoAiw2AiwgAiABKAIwNgIwIAIgASgCNDYCNCACIAEoAjg2AjggAiABKAI8NgI8IAFBwABqIQEgAkHAAGoiAiAFTQ0ACwsgAiAETw0BA0AgAiABKAIANgIAIAFBBGohASACQQRqIgIgBEkNAAwCAAsACwJAIANBBE8NACAAIQIMAQsCQCADQXxqIgQgAE8NACAAIQIMAQsgACECA0AgAiABLQAAOgAAIAIgAS0AAToAASACIAEtAAI6AAIgAiABLQADOgADIAFBBGohASACQQRqIgIgBE0NAAsLAkAgAiADTw0AA0AgAiABLQAAOgAAIAFBAWohASACQQFqIgIgA0cNAAsLIAAL8wICA38BfgJAIAJFDQAgAiAAaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIFayICQSBJDQAgAa0iBkIghiAGhCEGIAMgBWohAQNAIAEgBjcDGCABIAY3AxAgASAGNwMIIAEgBjcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACx0AAkBBACgCzEoNAEEAIAE2AtBKQQAgADYCzEoLCwYAIAAkAgsEACMACyEBAn8CQCMAIABrQXBxIgEiAiMCSQRAEAcLIAIkAAsgAQsUAQF/IAAiASMCSQRAEAcLIAEkAAsGACAAQAALCQAgASAAEQAACw0AIAEgAiADIAARAgALDQAgASACIAMgABEJAAsTACABIAIgAyAEIAUgBiAAEQ0ACwsAIAEgAiAAEQQACyQBAX4gACABIAKtIAOtQiCGhCAEEJsBIQUgBUIgiKcQCCAFpwsTACAAIAGnIAFCIIinIAIgAxAJCwviQgMAQYAIC+gaPD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PgA8IURPQ1RZUEUgc3ZnIFBVQkxJQyAiLS8vVzNDLy9EVEQgU1ZHIDIwMDEwOTA0Ly9FTiIAICJodHRwOi8vd3d3LnczLm9yZy9UUi8yMDAxL1JFQy1TVkctMjAwMTA5MDQvRFREL3N2ZzEwLmR0ZCI+ADxzdmcgdmVyc2lvbj0iMS4wIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciACB3aWR0aD0iJWYiIGhlaWdodD0iJWYiIHZpZXdCb3g9IjAgMCAlZiAlZiIAIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiPgA8ZyB0cmFuc2Zvcm09IgB0cmFuc2xhdGUoJWYsJWYpIABzY2FsZSglZiwlZikiIABmaWxsPSIjMDAwMDAwIiBzdHJva2U9Im5vbmUiPgA8L2c+ADwvc3ZnPgA8cGF0aCBkPSIAIi8+ACAAegBNJS4xZiAlLjFmAE0lbGQgJWxkAG0lLjFmICUuMWYAbSVsZCAlbGQAbCUuMWYgJS4xZgBsJWxkICVsZABjJS4xZiAlLjFmICUuMWYgJS4xZiAlLjFmICUuMWYAYyVsZCAlbGQgJWxkICVsZCAlbGQgJWxkACVzAAAAAAAAAAAAAAAAAAAAAAEBAAEAAQEAAQEAAAEBAQAAAAEBAQABAAEBAAEAAAAAAAABAQEAAQEAAAEAAAAAAAEAAAEBAAAAAQABAQEBAQEAAQEBAQEBAQABAQABAQEBAAEAAAABAQAAAAABAAEBAAABAQEAAAEAAQEBAQEBAQEBAQEAAQAAAAAAAAEAAQABAAEAAAEAAAEAAQEBAAEAAAAAAQAAAAAAAAEAAQABAAEAAAEBAAEAAAAAAAABAAAAAAEBAQEAAQEAAAEBAAABAQABAQAAAAEBAQEAAQAAAAABAAEBAQAAAAEAAQEAAAEBAQABAAABAQAAAQEBAAABAQEAAAAAAQABAAEAAQABAHRyYWNlIGVycm9yOiAlcwoAcGFnZV9zdmcgZXJyb3I6ICVzCgAAAAAAAAAAAAAAABkSRDsCPyxHFD0zMAobBkZLRTcPSQ6OFwNAHTxpKzYfSi0cASAlKSEIDBUWIi4QOD4LNDEYZHR1di9BCX85ESNDMkKJiosFBCYoJw0qHjWMBxpIkxOUlQAAAAAAAAAAAElsbGVnYWwgYnl0ZSBzZXF1ZW5jZQBEb21haW4gZXJyb3IAUmVzdWx0IG5vdCByZXByZXNlbnRhYmxlAE5vdCBhIHR0eQBQZXJtaXNzaW9uIGRlbmllZABPcGVyYXRpb24gbm90IHBlcm1pdHRlZABObyBzdWNoIGZpbGUgb3IgZGlyZWN0b3J5AE5vIHN1Y2ggcHJvY2VzcwBGaWxlIGV4aXN0cwBWYWx1ZSB0b28gbGFyZ2UgZm9yIGRhdGEgdHlwZQBObyBzcGFjZSBsZWZ0IG9uIGRldmljZQBPdXQgb2YgbWVtb3J5AFJlc291cmNlIGJ1c3kASW50ZXJydXB0ZWQgc3lzdGVtIGNhbGwAUmVzb3VyY2UgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGUASW52YWxpZCBzZWVrAENyb3NzLWRldmljZSBsaW5rAFJlYWQtb25seSBmaWxlIHN5c3RlbQBEaXJlY3Rvcnkgbm90IGVtcHR5AENvbm5lY3Rpb24gcmVzZXQgYnkgcGVlcgBPcGVyYXRpb24gdGltZWQgb3V0AENvbm5lY3Rpb24gcmVmdXNlZABIb3N0IGlzIGRvd24ASG9zdCBpcyB1bnJlYWNoYWJsZQBBZGRyZXNzIGluIHVzZQBCcm9rZW4gcGlwZQBJL08gZXJyb3IATm8gc3VjaCBkZXZpY2Ugb3IgYWRkcmVzcwBCbG9jayBkZXZpY2UgcmVxdWlyZWQATm8gc3VjaCBkZXZpY2UATm90IGEgZGlyZWN0b3J5AElzIGEgZGlyZWN0b3J5AFRleHQgZmlsZSBidXN5AEV4ZWMgZm9ybWF0IGVycm9yAEludmFsaWQgYXJndW1lbnQAQXJndW1lbnQgbGlzdCB0b28gbG9uZwBTeW1ib2xpYyBsaW5rIGxvb3AARmlsZW5hbWUgdG9vIGxvbmcAVG9vIG1hbnkgb3BlbiBmaWxlcyBpbiBzeXN0ZW0ATm8gZmlsZSBkZXNjcmlwdG9ycyBhdmFpbGFibGUAQmFkIGZpbGUgZGVzY3JpcHRvcgBObyBjaGlsZCBwcm9jZXNzAEJhZCBhZGRyZXNzAEZpbGUgdG9vIGxhcmdlAFRvbyBtYW55IGxpbmtzAE5vIGxvY2tzIGF2YWlsYWJsZQBSZXNvdXJjZSBkZWFkbG9jayB3b3VsZCBvY2N1cgBTdGF0ZSBub3QgcmVjb3ZlcmFibGUAUHJldmlvdXMgb3duZXIgZGllZABPcGVyYXRpb24gY2FuY2VsZWQARnVuY3Rpb24gbm90IGltcGxlbWVudGVkAE5vIG1lc3NhZ2Ugb2YgZGVzaXJlZCB0eXBlAElkZW50aWZpZXIgcmVtb3ZlZABEZXZpY2Ugbm90IGEgc3RyZWFtAE5vIGRhdGEgYXZhaWxhYmxlAERldmljZSB0aW1lb3V0AE91dCBvZiBzdHJlYW1zIHJlc291cmNlcwBMaW5rIGhhcyBiZWVuIHNldmVyZWQAUHJvdG9jb2wgZXJyb3IAQmFkIG1lc3NhZ2UARmlsZSBkZXNjcmlwdG9yIGluIGJhZCBzdGF0ZQBOb3QgYSBzb2NrZXQARGVzdGluYXRpb24gYWRkcmVzcyByZXF1aXJlZABNZXNzYWdlIHRvbyBsYXJnZQBQcm90b2NvbCB3cm9uZyB0eXBlIGZvciBzb2NrZXQAUHJvdG9jb2wgbm90IGF2YWlsYWJsZQBQcm90b2NvbCBub3Qgc3VwcG9ydGVkAFNvY2tldCB0eXBlIG5vdCBzdXBwb3J0ZWQATm90IHN1cHBvcnRlZABQcm90b2NvbCBmYW1pbHkgbm90IHN1cHBvcnRlZABBZGRyZXNzIGZhbWlseSBub3Qgc3VwcG9ydGVkIGJ5IHByb3RvY29sAEFkZHJlc3Mgbm90IGF2YWlsYWJsZQBOZXR3b3JrIGlzIGRvd24ATmV0d29yayB1bnJlYWNoYWJsZQBDb25uZWN0aW9uIHJlc2V0IGJ5IG5ldHdvcmsAQ29ubmVjdGlvbiBhYm9ydGVkAE5vIGJ1ZmZlciBzcGFjZSBhdmFpbGFibGUAU29ja2V0IGlzIGNvbm5lY3RlZABTb2NrZXQgbm90IGNvbm5lY3RlZABDYW5ub3Qgc2VuZCBhZnRlciBzb2NrZXQgc2h1dGRvd24AT3BlcmF0aW9uIGFscmVhZHkgaW4gcHJvZ3Jlc3MAT3BlcmF0aW9uIGluIHByb2dyZXNzAFN0YWxlIGZpbGUgaGFuZGxlAFJlbW90ZSBJL08gZXJyb3IAUXVvdGEgZXhjZWVkZWQATm8gbWVkaXVtIGZvdW5kAFdyb25nIG1lZGl1bSB0eXBlAE5vIGVycm9yIGluZm9ybWF0aW9uAABYEgAALSsgICAwWDB4AChudWxsKQAAAAAAAAAAAAAAAAAAAAARAAoAERERAAAAAAUAAAAAAAAJAAAAAAsAAAAAAAAAABEADwoREREDCgcAARMJCwsAAAkGCwAACwAGEQAAABEREQAAAAAAAAAAAAAAAAAAAAALAAAAAAAAAAARAAoKERERAAoAAAIACQsAAAAJAAsAAAsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAAMAAAAAAkMAAAAAAAMAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAA0AAAAEDQAAAAAJDgAAAAAADgAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAPAAAAAA8AAAAACRAAAAAAABAAABAAABIAAAASEhIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAABISEgAAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAAAAAAoAAAAACgAAAAAJCwAAAAAACwAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAwAAAAACQwAAAAAAAwAAAwAADAxMjM0NTY3ODlBQkNERUYtMFgrMFggMFgtMHgrMHggMHgAaW5mAElORgBuYW4ATkFOAC4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEHoIguAAwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACwjAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAADAAAATCMAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAP//////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABB8CUL5CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary() {
  try {
    if (wasmBinary) {
      return new Uint8Array(wasmBinary);
    }

    var binary = tryParseAsDataURI(wasmBinaryFile);
    if (binary) {
      return binary;
    }
    if (readBinary) {
      return readBinary(wasmBinaryFile);
    } else {
      throw "both async and sync fetching of the wasm failed";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}



// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm() {
  // prepare imports
  var info = {
    'env': asmLibraryArg,
    'wasi_snapshot_preview1': asmLibraryArg
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
   // we can't run yet (except in a pthread, where we have a custom sync instantiator)
  addRunDependency('wasm-instantiate');


  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }


  function instantiateArrayBuffer(receiver) {
    return getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }

  // Prefer streaming instantiation if available.
  function instantiateAsync() {
    if (!wasmBinary &&
        typeof WebAssembly.instantiateStreaming === 'function' &&
        !isDataURI(wasmBinaryFile) &&
        typeof fetch === 'function') {
      fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function (response) {
        var result = WebAssembly.instantiateStreaming(response, info);
        return result.then(receiveInstantiatedSource, function(reason) {
            // We expect the most common failure cause to be a bad MIME type for the binary,
            // in which case falling back to ArrayBuffer instantiation should work.
            err('wasm streaming compile failed: ' + reason);
            err('falling back to ArrayBuffer instantiation');
            instantiateArrayBuffer(receiveInstantiatedSource);
          });
      });
    } else {
      return instantiateArrayBuffer(receiveInstantiatedSource);
    }
  }
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      var exports = Module['instantiateWasm'](info, receiveInstance);
      return exports;
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  instantiateAsync();
  return {}; // no exports yet; we'll fill them in later
}


// Globals used by JS i64 conversions
var tempDouble;
var tempI64;

// === Body ===

var ASM_CONSTS = {
  
};




// STATICTOP = STATIC_BASE + 8704;
/* global initializers */  __ATINIT__.push({ func: function() { ___wasm_call_ctors() } });




/* no memory initializer */
// {{PRE_LIBRARY}}


  function demangle(func) {
      warnOnce('warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
      return func;
    }

  function demangleAll(text) {
      var regex =
        /\b_Z[\w\d_]+/g;
      return text.replace(regex,
        function(x) {
          var y = demangle(x);
          return x === y ? x : (y + ' [' + x + ']');
        });
    }

  function jsStackTrace() {
      var err = new Error();
      if (!err.stack) {
        // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
        // so try that as a special-case.
        try {
          throw new Error();
        } catch(e) {
          err = e;
        }
        if (!err.stack) {
          return '(no stack trace available)';
        }
      }
      return err.stack.toString();
    }

  function stackTrace() {
      var js = jsStackTrace();
      if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
      return demangleAll(js);
    }

  function ___handle_stack_overflow() {
      abort('stack overflow')
    }

  function ___lock() {}

  function ___unlock() {}

  function _emscripten_get_heap_size() {
      return HEAPU8.length;
    }

  function _emscripten_get_sbrk_ptr() {
      return 9568;
    }

  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }

  
  function emscripten_realloc_buffer(size) {
      try {
        // round size grow request up to wasm page size (fixed 64KB per spec)
        wasmMemory.grow((size - buffer.byteLength + 65535) >> 16); // .grow() takes a delta compared to the previous size
        updateGlobalBufferAndViews(wasmMemory.buffer);
        return 1 /*success*/;
      } catch(e) {
        console.error('emscripten_realloc_buffer: Attempted to grow heap from ' + buffer.byteLength  + ' bytes to ' + size + ' bytes, but got error: ' + e);
      }
    }function _emscripten_resize_heap(requestedSize) {
      var oldSize = _emscripten_get_heap_size();
      // With pthreads, races can happen (another thread might increase the size in between), so return a failure, and let the caller retry.
      assert(requestedSize > oldSize);
  
  
      var PAGE_MULTIPLE = 65536;
  
      // Memory resize rules:
      // 1. When resizing, always produce a resized heap that is at least 16MB (to avoid tiny heap sizes receiving lots of repeated resizes at startup)
      // 2. Always increase heap size to at least the requested size, rounded up to next page multiple.
      // 3a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap geometrically: increase the heap size according to 
      //                                         MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%),
      //                                         At most overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
      // 3b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap linearly: increase the heap size by at least MEMORY_GROWTH_LINEAR_STEP bytes.
      // 4. Max size for the heap is capped at 2048MB-PAGE_MULTIPLE, or by WASM_MEM_MAX, or by ASAN limit, depending on which is smallest
      // 5. If we were unable to allocate as much memory, it may be due to over-eager decision to excessively reserve due to (3) above.
      //    Hence if an allocation fails, cut down on the amount of excess growth, in an attempt to succeed to perform a smaller allocation.
  
      var maxHeapSize = 2147483648 - PAGE_MULTIPLE;
      if (requestedSize > maxHeapSize) {
        err('Cannot enlarge memory, asked to go up to ' + requestedSize + ' bytes, but the limit is ' + maxHeapSize + ' bytes!');
        return false;
      }
  
      var minHeapSize = 16777216;
  
      // Loop through potential heap size increases. If we attempt a too eager reservation that fails, cut down on the
      // attempted size and reserve a smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
      for(var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown); // ensure geometric growth
        // but limit overreserving (default to capping at +96MB overgrowth at most)
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296 );
  
  
        var newSize = Math.min(maxHeapSize, alignUp(Math.max(minHeapSize, requestedSize, overGrownHeapSize), PAGE_MULTIPLE));
  
        var replacement = emscripten_realloc_buffer(newSize);
        if (replacement) {
  
          return true;
        }
      }
      err('Failed to grow the heap from ' + oldSize + ' bytes to ' + newSize + ' bytes, not enough memory!');
      return false;
    }

  function _exit(status) {
      // void _exit(int status);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/exit.html
      exit(status);
    }

  
  
  var PATH={splitPath:function(filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function(parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function(path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function(path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function(path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function(path) {
        return PATH.splitPath(path)[3];
      },join:function() {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function(l, r) {
        return PATH.normalize(l + '/' + r);
      }};var SYSCALLS={buffers:[null,[],[]],printChar:function(stream, curr) {
        var buffer = SYSCALLS.buffers[stream];
        assert(buffer);
        if (curr === 0 || curr === 10) {
          (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
          buffer.length = 0;
        } else {
          buffer.push(curr);
        }
      },varargs:0,get:function(varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function() {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },get64:function() {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function() {
        assert(SYSCALLS.get() === 0);
      }};function _fd_close(fd) {try {
  
      abort('it should not be possible to operate on streams when !SYSCALLS_REQUIRE_FILESYSTEM');
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }

  function _fd_seek(fd, offset_low, offset_high, whence, newOffset) {try {
  
      abort('it should not be possible to operate on streams when !SYSCALLS_REQUIRE_FILESYSTEM');
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }

  
  function flush_NO_FILESYSTEM() {
      // flush anything remaining in the buffers during shutdown
      if (typeof _fflush !== 'undefined') _fflush(0);
      var buffers = SYSCALLS.buffers;
      if (buffers[1].length) SYSCALLS.printChar(1, 10);
      if (buffers[2].length) SYSCALLS.printChar(2, 10);
    }function _fd_write(fd, iov, iovcnt, pnum) {try {
  
      // hack to support printf in SYSCALLS_REQUIRE_FILESYSTEM=0
      var num = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAP32[(((iov)+(i*8))>>2)];
        var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
        for (var j = 0; j < len; j++) {
          SYSCALLS.printChar(fd, HEAPU8[ptr+j]);
        }
        num += len;
      }
      HEAP32[((pnum)>>2)]=num
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }

  
  function _memcpy(dest, src, num) {
      dest = dest|0; src = src|0; num = num|0;
      var ret = 0;
      var aligned_dest_end = 0;
      var block_aligned_dest_end = 0;
      var dest_end = 0;
      // Test against a benchmarked cutoff limit for when HEAPU8.set() becomes faster to use.
      if ((num|0) >= 8192) {
        _emscripten_memcpy_big(dest|0, src|0, num|0)|0;
        return dest|0;
      }
  
      ret = dest|0;
      dest_end = (dest + num)|0;
      if ((dest&3) == (src&3)) {
        // The initial unaligned < 4-byte front.
        while (dest & 3) {
          if ((num|0) == 0) return ret|0;
          HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
          dest = (dest+1)|0;
          src = (src+1)|0;
          num = (num-1)|0;
        }
        aligned_dest_end = (dest_end & -4)|0;
        block_aligned_dest_end = (aligned_dest_end - 64)|0;
        while ((dest|0) <= (block_aligned_dest_end|0) ) {
          HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
          HEAP32[(((dest)+(4))>>2)]=((HEAP32[(((src)+(4))>>2)])|0);
          HEAP32[(((dest)+(8))>>2)]=((HEAP32[(((src)+(8))>>2)])|0);
          HEAP32[(((dest)+(12))>>2)]=((HEAP32[(((src)+(12))>>2)])|0);
          HEAP32[(((dest)+(16))>>2)]=((HEAP32[(((src)+(16))>>2)])|0);
          HEAP32[(((dest)+(20))>>2)]=((HEAP32[(((src)+(20))>>2)])|0);
          HEAP32[(((dest)+(24))>>2)]=((HEAP32[(((src)+(24))>>2)])|0);
          HEAP32[(((dest)+(28))>>2)]=((HEAP32[(((src)+(28))>>2)])|0);
          HEAP32[(((dest)+(32))>>2)]=((HEAP32[(((src)+(32))>>2)])|0);
          HEAP32[(((dest)+(36))>>2)]=((HEAP32[(((src)+(36))>>2)])|0);
          HEAP32[(((dest)+(40))>>2)]=((HEAP32[(((src)+(40))>>2)])|0);
          HEAP32[(((dest)+(44))>>2)]=((HEAP32[(((src)+(44))>>2)])|0);
          HEAP32[(((dest)+(48))>>2)]=((HEAP32[(((src)+(48))>>2)])|0);
          HEAP32[(((dest)+(52))>>2)]=((HEAP32[(((src)+(52))>>2)])|0);
          HEAP32[(((dest)+(56))>>2)]=((HEAP32[(((src)+(56))>>2)])|0);
          HEAP32[(((dest)+(60))>>2)]=((HEAP32[(((src)+(60))>>2)])|0);
          dest = (dest+64)|0;
          src = (src+64)|0;
        }
        while ((dest|0) < (aligned_dest_end|0) ) {
          HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
          dest = (dest+4)|0;
          src = (src+4)|0;
        }
      } else {
        // In the unaligned copy case, unroll a bit as well.
        aligned_dest_end = (dest_end - 4)|0;
        while ((dest|0) < (aligned_dest_end|0) ) {
          HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
          HEAP8[(((dest)+(1))>>0)]=((HEAP8[(((src)+(1))>>0)])|0);
          HEAP8[(((dest)+(2))>>0)]=((HEAP8[(((src)+(2))>>0)])|0);
          HEAP8[(((dest)+(3))>>0)]=((HEAP8[(((src)+(3))>>0)])|0);
          dest = (dest+4)|0;
          src = (src+4)|0;
        }
      }
      // The remaining unaligned < 4 byte tail.
      while ((dest|0) < (dest_end|0)) {
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
        dest = (dest+1)|0;
        src = (src+1)|0;
      }
      return ret|0;
    }

  function _memset(ptr, value, num) {
      ptr = ptr|0; value = value|0; num = num|0;
      var end = 0, aligned_end = 0, block_aligned_end = 0, value4 = 0;
      end = (ptr + num)|0;
  
      value = value & 0xff;
      if ((num|0) >= 67 /* 64 bytes for an unrolled loop + 3 bytes for unaligned head*/) {
        while ((ptr&3) != 0) {
          HEAP8[((ptr)>>0)]=value;
          ptr = (ptr+1)|0;
        }
  
        aligned_end = (end & -4)|0;
        value4 = value | (value << 8) | (value << 16) | (value << 24);
  
        block_aligned_end = (aligned_end - 64)|0;
  
        while((ptr|0) <= (block_aligned_end|0)) {
          HEAP32[((ptr)>>2)]=value4;
          HEAP32[(((ptr)+(4))>>2)]=value4;
          HEAP32[(((ptr)+(8))>>2)]=value4;
          HEAP32[(((ptr)+(12))>>2)]=value4;
          HEAP32[(((ptr)+(16))>>2)]=value4;
          HEAP32[(((ptr)+(20))>>2)]=value4;
          HEAP32[(((ptr)+(24))>>2)]=value4;
          HEAP32[(((ptr)+(28))>>2)]=value4;
          HEAP32[(((ptr)+(32))>>2)]=value4;
          HEAP32[(((ptr)+(36))>>2)]=value4;
          HEAP32[(((ptr)+(40))>>2)]=value4;
          HEAP32[(((ptr)+(44))>>2)]=value4;
          HEAP32[(((ptr)+(48))>>2)]=value4;
          HEAP32[(((ptr)+(52))>>2)]=value4;
          HEAP32[(((ptr)+(56))>>2)]=value4;
          HEAP32[(((ptr)+(60))>>2)]=value4;
          ptr = (ptr + 64)|0;
        }
  
        while ((ptr|0) < (aligned_end|0) ) {
          HEAP32[((ptr)>>2)]=value4;
          ptr = (ptr+4)|0;
        }
      }
      // The remaining bytes.
      while ((ptr|0) < (end|0)) {
        HEAP8[((ptr)>>0)]=value;
        ptr = (ptr+1)|0;
      }
      return (end-num)|0;
    }

  function _setTempRet0($i) {
      setTempRet0(($i) | 0);
    }
var ASSERTIONS = true;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149

// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

/**
 * Decodes a base64 string.
 * @param {String} input The string to decode.
 */
var decodeBase64 = typeof atob === 'function' ? atob : function (input) {
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
};

// Converts a string of base64 into a byte array.
// Throws error on invalid input.
function intArrayFromBase64(s) {
  if (typeof ENVIRONMENT_IS_NODE === 'boolean' && ENVIRONMENT_IS_NODE) {
    var buf;
    try {
      buf = Buffer.from(s, 'base64');
    } catch (_) {
      buf = new Buffer(s, 'base64');
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  try {
    var decoded = decodeBase64(s);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0 ; i < decoded.length ; ++i) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Error('Converting base64 string to bytes failed.');
  }
}

// If filename is a base64 data URI, parses and returns data (Buffer on node,
// Uint8Array otherwise). If filename is not a base64 data URI, returns undefined.
function tryParseAsDataURI(filename) {
  if (!isDataURI(filename)) {
    return;
  }

  return intArrayFromBase64(filename.slice(dataURIPrefix.length));
}


// ASM_LIBRARY EXTERN PRIMITIVES: Int8Array,Int32Array

var asmGlobalArg = {};
var asmLibraryArg = { "__handle_stack_overflow": ___handle_stack_overflow, "__lock": ___lock, "__unlock": ___unlock, "emscripten_get_sbrk_ptr": _emscripten_get_sbrk_ptr, "emscripten_memcpy_big": _emscripten_memcpy_big, "emscripten_resize_heap": _emscripten_resize_heap, "exit": _exit, "fd_close": _fd_close, "fd_seek": _fd_seek, "fd_write": _fd_write, "memory": wasmMemory, "setTempRet0": _setTempRet0, "table": wasmTable };
var asm = createWasm();
Module["asm"] = asm;
var ___wasm_call_ctors = Module["___wasm_call_ctors"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__wasm_call_ctors"].apply(null, arguments)
};

var _fflush = Module["_fflush"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["fflush"].apply(null, arguments)
};

var _free = Module["_free"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["free"].apply(null, arguments)
};

var ___errno_location = Module["___errno_location"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__errno_location"].apply(null, arguments)
};

var _malloc = Module["_malloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["malloc"].apply(null, arguments)
};

var _start = Module["_start"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["start"].apply(null, arguments)
};

var _setThrew = Module["_setThrew"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["setThrew"].apply(null, arguments)
};

var ___set_stack_limit = Module["___set_stack_limit"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__set_stack_limit"].apply(null, arguments)
};

var stackSave = Module["stackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackSave"].apply(null, arguments)
};

var stackAlloc = Module["stackAlloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackAlloc"].apply(null, arguments)
};

var stackRestore = Module["stackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackRestore"].apply(null, arguments)
};

var __growWasmMemory = Module["__growWasmMemory"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__growWasmMemory"].apply(null, arguments)
};

var dynCall_ii = Module["dynCall_ii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_ii"].apply(null, arguments)
};

var dynCall_iiii = Module["dynCall_iiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiii"].apply(null, arguments)
};

var dynCall_jiji = Module["dynCall_jiji"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_jiji"].apply(null, arguments)
};

var dynCall_iidiiii = Module["dynCall_iidiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iidiiii"].apply(null, arguments)
};

var dynCall_vii = Module["dynCall_vii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vii"].apply(null, arguments)
};




// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;

if (!Object.getOwnPropertyDescriptor(Module, "intArrayFromString")) Module["intArrayFromString"] = function() { abort("'intArrayFromString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "intArrayToString")) Module["intArrayToString"] = function() { abort("'intArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ccall")) Module["ccall"] = function() { abort("'ccall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "cwrap")) Module["cwrap"] = function() { abort("'cwrap' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setValue")) Module["setValue"] = function() { abort("'setValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getValue")) Module["getValue"] = function() { abort("'getValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocate")) Module["allocate"] = function() { abort("'allocate' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getMemory")) Module["getMemory"] = function() { abort("'getMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF8ArrayToString")) Module["UTF8ArrayToString"] = function() { abort("'UTF8ArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF8ToString")) Module["UTF8ToString"] = function() { abort("'UTF8ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF8Array")) Module["stringToUTF8Array"] = function() { abort("'stringToUTF8Array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF8")) Module["stringToUTF8"] = function() { abort("'stringToUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF8")) Module["lengthBytesUTF8"] = function() { abort("'lengthBytesUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackTrace")) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPreRun")) Module["addOnPreRun"] = function() { abort("'addOnPreRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnInit")) Module["addOnInit"] = function() { abort("'addOnInit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPreMain")) Module["addOnPreMain"] = function() { abort("'addOnPreMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnExit")) Module["addOnExit"] = function() { abort("'addOnExit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPostRun")) Module["addOnPostRun"] = function() { abort("'addOnPostRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeStringToMemory")) Module["writeStringToMemory"] = function() { abort("'writeStringToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeArrayToMemory")) Module["writeArrayToMemory"] = function() { abort("'writeArrayToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeAsciiToMemory")) Module["writeAsciiToMemory"] = function() { abort("'writeAsciiToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addRunDependency")) Module["addRunDependency"] = function() { abort("'addRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "removeRunDependency")) Module["removeRunDependency"] = function() { abort("'removeRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createFolder")) Module["FS_createFolder"] = function() { abort("'FS_createFolder' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createPath")) Module["FS_createPath"] = function() { abort("'FS_createPath' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createDataFile")) Module["FS_createDataFile"] = function() { abort("'FS_createDataFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createPreloadedFile")) Module["FS_createPreloadedFile"] = function() { abort("'FS_createPreloadedFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createLazyFile")) Module["FS_createLazyFile"] = function() { abort("'FS_createLazyFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createLink")) Module["FS_createLink"] = function() { abort("'FS_createLink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createDevice")) Module["FS_createDevice"] = function() { abort("'FS_createDevice' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_unlink")) Module["FS_unlink"] = function() { abort("'FS_unlink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "dynamicAlloc")) Module["dynamicAlloc"] = function() { abort("'dynamicAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "loadDynamicLibrary")) Module["loadDynamicLibrary"] = function() { abort("'loadDynamicLibrary' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "loadWebAssemblyModule")) Module["loadWebAssemblyModule"] = function() { abort("'loadWebAssemblyModule' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getLEB")) Module["getLEB"] = function() { abort("'getLEB' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getFunctionTables")) Module["getFunctionTables"] = function() { abort("'getFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "alignFunctionTables")) Module["alignFunctionTables"] = function() { abort("'alignFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registerFunctions")) Module["registerFunctions"] = function() { abort("'registerFunctions' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addFunction")) Module["addFunction"] = function() { abort("'addFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "removeFunction")) Module["removeFunction"] = function() { abort("'removeFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getFuncWrapper")) Module["getFuncWrapper"] = function() { abort("'getFuncWrapper' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "prettyPrint")) Module["prettyPrint"] = function() { abort("'prettyPrint' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "makeBigInt")) Module["makeBigInt"] = function() { abort("'makeBigInt' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "dynCall")) Module["dynCall"] = function() { abort("'dynCall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getCompilerSetting")) Module["getCompilerSetting"] = function() { abort("'getCompilerSetting' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "print")) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "printErr")) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getTempRet0")) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setTempRet0")) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "callMain")) Module["callMain"] = function() { abort("'callMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "abort")) Module["abort"] = function() { abort("'abort' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PROCINFO")) Module["PROCINFO"] = function() { abort("'PROCINFO' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToNewUTF8")) Module["stringToNewUTF8"] = function() { abort("'stringToNewUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscripten_realloc_buffer")) Module["emscripten_realloc_buffer"] = function() { abort("'emscripten_realloc_buffer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ENV")) Module["ENV"] = function() { abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setjmpId")) Module["setjmpId"] = function() { abort("'setjmpId' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ERRNO_CODES")) Module["ERRNO_CODES"] = function() { abort("'ERRNO_CODES' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ERRNO_MESSAGES")) Module["ERRNO_MESSAGES"] = function() { abort("'ERRNO_MESSAGES' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "DNS__deps")) Module["DNS__deps"] = function() { abort("'DNS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "DNS")) Module["DNS"] = function() { abort("'DNS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GAI_ERRNO_MESSAGES")) Module["GAI_ERRNO_MESSAGES"] = function() { abort("'GAI_ERRNO_MESSAGES' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Protocols")) Module["Protocols"] = function() { abort("'Protocols' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Sockets__deps")) Module["Sockets__deps"] = function() { abort("'Sockets__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Sockets")) Module["Sockets"] = function() { abort("'Sockets' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UNWIND_CACHE")) Module["UNWIND_CACHE"] = function() { abort("'UNWIND_CACHE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readAsmConstArgs")) Module["readAsmConstArgs"] = function() { abort("'readAsmConstArgs' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PATH")) Module["PATH"] = function() { abort("'PATH' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PATH_FS__deps")) Module["PATH_FS__deps"] = function() { abort("'PATH_FS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PATH_FS")) Module["PATH_FS"] = function() { abort("'PATH_FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SYSCALLS__deps")) Module["SYSCALLS__deps"] = function() { abort("'SYSCALLS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SYSCALLS")) Module["SYSCALLS"] = function() { abort("'SYSCALLS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "flush_NO_FILESYSTEM")) Module["flush_NO_FILESYSTEM"] = function() { abort("'flush_NO_FILESYSTEM' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "JSEvents")) Module["JSEvents"] = function() { abort("'JSEvents' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "demangle__deps")) Module["demangle__deps"] = function() { abort("'demangle__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "demangle")) Module["demangle"] = function() { abort("'demangle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "demangleAll")) Module["demangleAll"] = function() { abort("'demangleAll' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "jsStackTrace")) Module["jsStackTrace"] = function() { abort("'jsStackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackTrace")) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64__deps")) Module["writeI53ToI64__deps"] = function() { abort("'writeI53ToI64__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64")) Module["writeI53ToI64"] = function() { abort("'writeI53ToI64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64Clamped")) Module["writeI53ToI64Clamped"] = function() { abort("'writeI53ToI64Clamped' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64Signaling")) Module["writeI53ToI64Signaling"] = function() { abort("'writeI53ToI64Signaling' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToU64Clamped")) Module["writeI53ToU64Clamped"] = function() { abort("'writeI53ToU64Clamped' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToU64Signaling")) Module["writeI53ToU64Signaling"] = function() { abort("'writeI53ToU64Signaling' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readI53FromI64")) Module["readI53FromI64"] = function() { abort("'readI53FromI64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readI53FromU64")) Module["readI53FromU64"] = function() { abort("'readI53FromU64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "convertI32PairToI53")) Module["convertI32PairToI53"] = function() { abort("'convertI32PairToI53' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "convertU32PairToI53")) Module["convertU32PairToI53"] = function() { abort("'convertU32PairToI53' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Browser__deps")) Module["Browser__deps"] = function() { abort("'Browser__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Browser__postset")) Module["Browser__postset"] = function() { abort("'Browser__postset' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Browser")) Module["Browser"] = function() { abort("'Browser' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Browser__postset__deps")) Module["Browser__postset__deps"] = function() { abort("'Browser__postset__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "FS__deps")) Module["FS__deps"] = function() { abort("'FS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "FS__postset")) Module["FS__postset"] = function() { abort("'FS__postset' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "FS")) Module["FS"] = function() { abort("'FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "MEMFS__deps")) Module["MEMFS__deps"] = function() { abort("'MEMFS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "MEMFS")) Module["MEMFS"] = function() { abort("'MEMFS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "TTY__deps")) Module["TTY__deps"] = function() { abort("'TTY__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "TTY__postset")) Module["TTY__postset"] = function() { abort("'TTY__postset' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "TTY")) Module["TTY"] = function() { abort("'TTY' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PIPEFS__postset")) Module["PIPEFS__postset"] = function() { abort("'PIPEFS__postset' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PIPEFS__deps")) Module["PIPEFS__deps"] = function() { abort("'PIPEFS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PIPEFS")) Module["PIPEFS"] = function() { abort("'PIPEFS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SOCKFS__postset")) Module["SOCKFS__postset"] = function() { abort("'SOCKFS__postset' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SOCKFS__deps")) Module["SOCKFS__deps"] = function() { abort("'SOCKFS__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SOCKFS")) Module["SOCKFS"] = function() { abort("'SOCKFS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GL__postset")) Module["GL__postset"] = function() { abort("'GL__postset' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GL__deps")) Module["GL__deps"] = function() { abort("'GL__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GL")) Module["GL"] = function() { abort("'GL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGet__deps")) Module["emscriptenWebGLGet__deps"] = function() { abort("'emscriptenWebGLGet__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGet")) Module["emscriptenWebGLGet"] = function() { abort("'emscriptenWebGLGet' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetTexPixelData__deps")) Module["emscriptenWebGLGetTexPixelData__deps"] = function() { abort("'emscriptenWebGLGetTexPixelData__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetTexPixelData")) Module["emscriptenWebGLGetTexPixelData"] = function() { abort("'emscriptenWebGLGetTexPixelData' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetUniform")) Module["emscriptenWebGLGetUniform"] = function() { abort("'emscriptenWebGLGetUniform' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetVertexAttrib")) Module["emscriptenWebGLGetVertexAttrib"] = function() { abort("'emscriptenWebGLGetVertexAttrib' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GL__postset__deps")) Module["GL__postset__deps"] = function() { abort("'GL__postset__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetUniform__deps")) Module["emscriptenWebGLGetUniform__deps"] = function() { abort("'emscriptenWebGLGetUniform__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetVertexAttrib__deps")) Module["emscriptenWebGLGetVertexAttrib__deps"] = function() { abort("'emscriptenWebGLGetVertexAttrib__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "AL__deps")) Module["AL__deps"] = function() { abort("'AL__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "AL")) Module["AL"] = function() { abort("'AL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "WebVR")) Module["WebVR"] = function() { abort("'WebVR' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "WebVR__deps")) Module["WebVR__deps"] = function() { abort("'WebVR__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SDL__deps")) Module["SDL__deps"] = function() { abort("'SDL__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SDL")) Module["SDL"] = function() { abort("'SDL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SDL_gfx")) Module["SDL_gfx"] = function() { abort("'SDL_gfx' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SDL_gfx__deps")) Module["SDL_gfx__deps"] = function() { abort("'SDL_gfx__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLUT__deps")) Module["GLUT__deps"] = function() { abort("'GLUT__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLUT")) Module["GLUT"] = function() { abort("'GLUT' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "EGL__deps")) Module["EGL__deps"] = function() { abort("'EGL__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "EGL")) Module["EGL"] = function() { abort("'EGL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLFW__deps")) Module["GLFW__deps"] = function() { abort("'GLFW__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLFW")) Module["GLFW"] = function() { abort("'GLFW' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLEW__deps")) Module["GLEW__deps"] = function() { abort("'GLEW__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLEW")) Module["GLEW"] = function() { abort("'GLEW' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "IDBStore")) Module["IDBStore"] = function() { abort("'IDBStore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "IDBStore__deps")) Module["IDBStore__deps"] = function() { abort("'IDBStore__deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "runAndAbortIfError")) Module["runAndAbortIfError"] = function() { abort("'runAndAbortIfError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "warnOnce")) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackSave")) Module["stackSave"] = function() { abort("'stackSave' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackRestore")) Module["stackRestore"] = function() { abort("'stackRestore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackAlloc")) Module["stackAlloc"] = function() { abort("'stackAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "AsciiToString")) Module["AsciiToString"] = function() { abort("'AsciiToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToAscii")) Module["stringToAscii"] = function() { abort("'stringToAscii' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF16ToString")) Module["UTF16ToString"] = function() { abort("'UTF16ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF16")) Module["stringToUTF16"] = function() { abort("'stringToUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF16")) Module["lengthBytesUTF16"] = function() { abort("'lengthBytesUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF32ToString")) Module["UTF32ToString"] = function() { abort("'UTF32ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF32")) Module["stringToUTF32"] = function() { abort("'stringToUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF32")) Module["lengthBytesUTF32"] = function() { abort("'lengthBytesUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocateUTF8")) Module["allocateUTF8"] = function() { abort("'allocateUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocateUTF8OnStack")) Module["allocateUTF8OnStack"] = function() { abort("'allocateUTF8OnStack' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
Module["writeStackCookie"] = writeStackCookie;
Module["checkStackCookie"] = checkStackCookie;
Module["abortStackOverflow"] = abortStackOverflow;
if (!Object.getOwnPropertyDescriptor(Module, "intArrayFromBase64")) Module["intArrayFromBase64"] = function() { abort("'intArrayFromBase64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "tryParseAsDataURI")) Module["tryParseAsDataURI"] = function() { abort("'tryParseAsDataURI' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_NORMAL")) Object.defineProperty(Module, "ALLOC_NORMAL", { configurable: true, get: function() { abort("'ALLOC_NORMAL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_STACK")) Object.defineProperty(Module, "ALLOC_STACK", { configurable: true, get: function() { abort("'ALLOC_STACK' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_DYNAMIC")) Object.defineProperty(Module, "ALLOC_DYNAMIC", { configurable: true, get: function() { abort("'ALLOC_DYNAMIC' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_NONE")) Object.defineProperty(Module, "ALLOC_NONE", { configurable: true, get: function() { abort("'ALLOC_NONE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "calledRun")) Object.defineProperty(Module, "calledRun", { configurable: true, get: function() { abort("'calledRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") } });



var calledRun;


/**
 * @constructor
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
}

var calledMain = false;


dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};





/** @type {function(Array=)} */
function run(args) {
  args = args || arguments_;

  if (runDependencies > 0) {
    return;
  }

  writeStackCookie();

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();

    assert(!Module['_main'], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
  checkStackCookie();
}
Module['run'] = run;

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var print = out;
  var printErr = err;
  var has = false;
  out = err = function(x) {
    has = true;
  }
  try { // it doesn't matter if it fails
    var flush = flush_NO_FILESYSTEM;
    if (flush) flush(0);
  } catch(e) {}
  out = print;
  err = printErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.');
    warnOnce('(this may also be due to not including full filesystem support - try building with -s FORCE_FILESYSTEM=1)');
  }
}

function exit(status, implicit) {
  checkUnflushedContent();

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && noExitRuntime && status === 0) {
    return;
  }

  if (noExitRuntime) {
    // if exit() was called, we may warn the user if the runtime isn't actually being shut down
    if (!implicit) {
      err('program exited (with status: ' + status + '), but EXIT_RUNTIME is not set, so halting execution but not exiting the runtime or preventing further async execution (build with EXIT_RUNTIME=1, if you want a true shutdown)');
    }
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  quit_(status, new ExitStatus(status));
}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  noExitRuntime = true;

run();





// {{MODULE_ADDITIONS}}



/**
 * This file will be inserted to generated output when building the library.
 */

/**
 * @param colorFilter return true if given pixel will be traced.
 * @param transform whether add the <transform /> tag to reduce generated svg length.
 * @param pathonly only returns concated path data.
 */
const defaultConfig = {
  colorFilter: (r, g, b, a) => a && 0.2126 * r + 0.7152 * g + 0.0722 * b < 128,
  transform: true,
  pathonly: false
};

/**
 * @param config for customizing.
 * @returns merged config with default value.
 */
function buildConfig(config) {
  if (!config) {
    return Object.assign({}, defaultConfig);
  }
  let merged = Object.assign({}, config);
  for (let prop in defaultConfig) {
    if (!config.hasOwnProperty(prop)) {
      merged[prop] = defaultConfig[prop];
    }
  }
  return merged;
}

/**
 * @returns promise to wait for wasm loaded.
 */
function ready() {
  return new Promise(resolve => {
    if (runtimeInitialized) {
      resolve();
      return;
    }
    Module.onRuntimeInitialized = () => {
      resolve();
    };
  });
}

/**
 * @param canvas to be converted for svg.
 * @param config for customizing.
 * @returns promise that emits a svg string or path data array.
 */
async function loadFromCanvas(canvas, config, params) {
  let ctx = canvas.getContext("2d");
  let imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return loadFromImageData(imagedata, canvas.width, canvas.height, config, params);
}

/**
 * @param imagedata to be converted for svg.
 * @param width for the imageData.
 * @param height for the imageData.
 * @param config for customizing.
 * @returns promise that emits a svg string or path data array.
 */
async function loadFromImageData(imagedata, width, height, config, params) {
  let start = wrapStart();
  let data = new Array(Math.ceil(imagedata.length / 32)).fill(0);
  let c = buildConfig(config);

  for (i = 0; i < imagedata.length; i += 4) {
    let r = imagedata[i],
      g = imagedata[i + 1],
      b = imagedata[i + 2],
      a = imagedata[i + 3];

    if (c.colorFilter(r, g, b, a)) {
      // each number contains 8 pixels from rightmost bit.
      let index = Math.floor(i / 4);
      data[Math.floor(index / 8)] += 1 << index % 8;
    }
  }

  await ready();
  let result = start(
    data,
    width,
    height,
    c.transform,
    c.pathonly,
    params.turdsize,
    params.turnpolicy,
    params.alphamax,
    params.opticurve,
    params.opttolerance
    );

  if (config.pathonly) {
    return result
      .split("M")
      .filter(path => path)
      .map(path => "M" + path);
  }
  return result;
}

/**
 * @returns wrapped function for start.
 */
function wrapStart() {
  return cwrap("start", "string", [
    "array", // pixels
    "number", // width
    "number", // height
    "number", // transform
    "number", // pathonly
    "number", // turdsize
    "number", // turnpolicy
    "number", // alphamax
    "number", // opticurve
    "number"  // opttolerance
  ]);
}

// export the functions in server env.
if (typeof module !== "undefined") {
  module.exports = { loadFromCanvas, loadFromImageData };
}

