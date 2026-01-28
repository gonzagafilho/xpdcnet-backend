const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { registerUser } = require('../services/authService');

/**
 * REGISTER
 * Criação de usuário (delegado ao service)
 */
exports.register = async (req, res) => {
  try {
    const result = await registerUser(req.body);

    return res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: {
        id: result.user._id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role
      }
    });
  } catch (error) {
    console.error('Erro no register:', error);
    return res.status(500).json({
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * LOGIN
 * Autenticação com JWT
 * (mantido exatamente como estava)
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // validação
    if (!email || !password) {
      return res.status(400).json({
        message: 'Email e senha são obrigatórios'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        message: 'Credenciais inválidas'
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Credenciais inválidas'
      });
    }

    // 🔐 gera token JWT
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
      }
    );

    return res.status(200).json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({
      message: 'Erro interno do servidor'
    });
  }
};

/**
 * ME
 * Retorna dados do usuário autenticado
 * (mantido exatamente como estava)
 */
exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');

    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }

    return res.status(200).json({
      user
    });
  } catch (error) {
    console.error('Erro no /me:', error);
    return res.status(500).json({
      message: 'Erro interno do servidor'
    });
  }
};

