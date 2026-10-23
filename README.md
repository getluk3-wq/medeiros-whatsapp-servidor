# Robô Medeiros Divulgação — Agendador WhatsApp

Serviço separado do site principal. Não altera o site Netlify, o teste grátis, o painel atual nem os cadastros existentes.

## Incluído
- Painel responsivo para celular.
- Conexão de sessão por QR Code do WhatsApp Web.
- Lista de grupos e seleção manual dos grupos autorizados.
- Agendamento por dias da semana e horário de Brasília.
- Ativar/pausar envios, excluir agendamentos e visualizar estado.
- Limite padrão de 10 mensagens por dia e intervalo de 5 segundos entre envios.
- Armazenamento persistente configurável.
- Dockerfile e `render.yaml` para implantação em serviço Node.js com disco persistente.

## Limites importantes
- **Ainda não busca produtos automaticamente nem gera links de afiliado.** Isso exige acesso autorizado às APIs e credenciais das plataformas de afiliados.
- A conexão `whatsapp-web.js` é não oficial. O WhatsApp pode desconectar ou restringir a conta. Use apenas grupos que autorizaram receber promoções; não use para spam ou disparos em massa. Considere um número separado, aceitando o risco.
- O serviço precisa ficar online continuamente. Hospedagem gratuita que dorme ou não oferece disco persistente não é adequada.
- O pacote está preparado para implantação, mas **não está publicado nem conectado ao WhatsApp**. É preciso criar o serviço na sua conta de hospedagem, definir a senha e concluir a conexão.
- O pacote não contorna as regras do WhatsApp nem substitui a API oficial do WhatsApp Business.

## Implantação no Render
1. Envie os arquivos deste ZIP para um repositório privado no GitHub.
2. No Render, escolha **New → Blueprint** e conecte o repositório.
3. Revise o serviço `medeiros-agendador-whatsapp` e confirme. O `render.yaml` solicita serviço Starter e disco persistente; pode haver cobrança.
4. Na hospedagem, confira `ADMIN_PASSWORD` e troque por uma senha longa e exclusiva. Nunca publique essa senha.
5. Abra a URL HTTPS do serviço e entre no painel.
6. Toque em **Entrar / atualizar status**. Quando o QR aparecer, no WhatsApp normal: **Aparelhos conectados → Conectar aparelho**.
7. Carregue os grupos e selecione apenas os que aceitaram receber promoções. Crie um agendamento e teste com um único grupo.
8. Ative o automático somente depois de conferir grupo, horário, texto e link.

## Uso no celular
Você pode administrar o painel e fazer o vínculo inicial pelo celular. O serviço de envio roda na hospedagem e precisa permanecer online; o navegador do celular não mantém a automação sozinho.

## Variáveis
- `ADMIN_PASSWORD`: obrigatória, configurada na hospedagem.
- `PORT`: fornecida pela hospedagem.
- `TZ`: `America/Sao_Paulo`.
- `MAX_MESSAGES_PER_DAY`: padrão `10`.
- `DATA_DIR`: caminho do disco persistente (`/var/data` no Render).

## Segurança
- Não compartilhe QR Code, senha, `.wwebjs_auth` nem `data.json`.
- Se suspeitar de acesso indevido, pause a automação e encerre a sessão em WhatsApp → Aparelhos conectados.
- `/health` informa apenas a saúde do processo, não garante que o WhatsApp esteja conectado.
