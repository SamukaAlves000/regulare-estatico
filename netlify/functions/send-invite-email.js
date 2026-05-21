const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

// Inicializar Firebase Admin se as credenciais estiverem presentes
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('[DEBUG] Firebase Admin inicializado via Service Account');
    } else {
      admin.initializeApp();
      console.log('[DEBUG] Firebase Admin inicializado (default)');
    }
  } catch (error) {
    console.warn('[DEBUG] Firebase Admin não pôde ser inicializado:', error.message);
  }
}

exports.handler = async (event, context) => {
  console.log('[DEBUG] Function send-invite-email disparada');
  console.log('[DEBUG] Method:', event.httpMethod);

  // 1. Validar método HTTP
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
    };
  }

  // 2. Validar variáveis de ambiente
  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.error('[ERROR] EMAIL_USER ou EMAIL_PASS não configurados');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Configuração de e-mail ausente no servidor' })
    };
  }

  try {
    // 3. Parse e validação do corpo da requisição
    const body = JSON.parse(event.body);
    const { to, companyName, userName, type = 'INVITE', origin } = body;
    let { inviteLink } = body;

    if (!to || !companyName || !userName) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Campos obrigatórios ausentes' }),
      };
    }

    // 3.1 Gerar link real do Firebase se possível
    if (admin.apps.length > 0) {
      try {
        const actionCodeSettings = {
          url: origin ? `${origin}/login` : 'https://regulare.netlify.app/login',
          handleCodeInApp: true,
        };
        // Tentar gerar link real. Se falhar, vai para o catch.
        const realLink = await admin.auth().generatePasswordResetLink(to, actionCodeSettings);
        inviteLink = realLink;
        console.log('[DEBUG] Link real do Firebase gerado com sucesso:', inviteLink);
      } catch (linkError) {
        console.warn('[DEBUG] Erro ao gerar link do Firebase (usando fallback):', linkError.message);
        // Se falhar a geração do link real e NÃO recebemos um link do frontend, usamos o login como última opção
        if (!inviteLink) {
          inviteLink = origin ? `${origin}/login` : 'https://regulare.netlify.app/login';
          console.log('[DEBUG] Usando fallback de login:', inviteLink);
        }
      }
    } else {
      console.warn('[DEBUG] Firebase Admin não inicializado. Verifique a variável FIREBASE_SERVICE_ACCOUNT.');
      if (!inviteLink) {
        inviteLink = origin ? `${origin}/login` : 'https://regulare.netlify.app/login';
        console.log('[DEBUG] Usando fallback de login (Admin não inicializado):', inviteLink);
      }
    }

    const isReset = type === 'RESET';
    const subject = isReset ? 'Redefinição de Senha - Regulare' : 'Convite de Acesso - Regulare';
    const title = isReset ? 'Redefinição de Senha' : 'Bem-vindo ao Regulare!';
    const actionText = isReset ? 'Redefinir Senha' : 'Definir Senha';
    
    console.log(`[DEBUG] Enviando e-mail de ${type} para:`, to);

    // 4. Configurar Transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // Usar STARTTLS
      family: 4,
      connectionTimeout: 45000, // Aumentado para 45s
      greetingTimeout: 45000,
      socketTimeout: 45000,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      },
      debug: true,
      logger: true,
      tls: {
        rejectUnauthorized: false,
        // Forçar TLS 1.2 ou superior se possível
        minVersion: 'TLSv1.2'
      }
    });

    console.log('[DEBUG] Tentando conexão via Porta 587 (STARTTLS)...');
    
    // Validar conexão antes de enviar
    console.log('[DEBUG] Verificando conexão SMTP...');
    try {
      await transporter.verify();
      console.log('[DEBUG] Conexão SMTP verificada com sucesso via 587');
    } catch (v587Error) {
      console.warn('[DEBUG] Falha na porta 587, tentando porta 465 como último recurso...');
      
      const transporter465 = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        family: 4,
        connectionTimeout: 45000,
        greetingTimeout: 45000,
        socketTimeout: 45000,
        auth: {
          user: EMAIL_USER,
          pass: EMAIL_PASS
        },
        debug: true,
        logger: true,
        tls: {
          rejectUnauthorized: false
        }
      });
      
      await transporter465.verify();
      // Se chegar aqui, usamos o de 465 para o resto da execução
      console.log('[DEBUG] Conexão SMTP verificada com sucesso via 465');
      
      // Re-assign para usar no sendMail abaixo
      transporter.sendMail = transporter465.sendMail.bind(transporter465);
    }

    // 5. Template HTML (Padrão corporativo Regulare)
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f7f6; color: #333; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .header { background-color: #1a1a1a; padding: 30px; text-align: center; }
        .content { padding: 40px; line-height: 1.6; }
        .content h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 20px; }
        .info-box { background-color: #f8f9fa; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0; }
        .button-container { text-align: center; margin-top: 30px; }
        .button { background-color: #007bff; color: #ffffff !important; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><h2 style="color: #ffffff; margin: 0;">REGULARE</h2></div>
        <div class="content">
            <h1>Olá, ${userName}!</h1>
            ${isReset 
              ? `<p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Regulare</strong>.</p>
                 <p>Se você não solicitou essa alteração, pode ignorar este e-mail com segurança.</p>`
              : `<p>Você foi convidado para acessar a plataforma <strong>Regulare</strong>.</p>`
            }
            <div class="info-box"><strong>Empresa vinculada:</strong> ${companyName}</div>
            <p>${isReset 
              ? 'Para criar uma nova senha, clique no botão abaixo:' 
              : 'Para começar a utilizar o sistema, você precisa definir sua senha de acesso clicando no botão abaixo:'
            }</p>
            <div class="button-container"><a href="${inviteLink}" class="button">${actionText}</a></div>
            <p style="margin-top: 30px; font-size: 14px; color: #555;">
                Se o botão acima não funcionar, clique no link abaixo ou copie e cole no seu navegador: <br>
                <a href="${inviteLink}" style="word-break: break-all; color: #007bff; text-decoration: underline;">${inviteLink}</a>
            </p>
        </div>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Regulare - Gestão de Conformidade e Segurança.<br>
            E-mail automático, por favor não responda.
        </div>
    </div>
</body>
</html>`;

    // 6. Enviar E-mail
    await transporter.sendMail({
      from: `"Regulare" <${EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: htmlContent,
    });

    console.log('[DEBUG] E-mail enviado com sucesso para:', to);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'E-mail enviado com sucesso' }),
    };

  } catch (error) {
    console.error('[ERROR] Erro na função send-invite-email:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message || 'Erro interno ao enviar e-mail',
        code: error.code || 'UNKNOWN_ERROR'
      }),
    };
  }
};
