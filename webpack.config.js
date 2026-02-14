const path = require('path');

module.exports = {
  entry: './main.js',

  output: {
    filename: 'content_bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  mode: 'development', 
  devtool: 'inline-source-map',
};