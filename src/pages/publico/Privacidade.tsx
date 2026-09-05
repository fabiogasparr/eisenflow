import { Link } from 'react-router-dom';
import { PaginaPublica } from '@/components/PaginaPublica';

export default function Privacidade() {
  return (
    <PaginaPublica titulo="Política de Privacidade" atualizadoEm="5 de setembro de 2026">
      <p>
        Esta política explica quais dados o <strong>EisenFlow</strong> coleta, por que coleta, com
        quem compartilha e o que você pode exigir a respeito. Ela descreve o funcionamento real do
        aplicativo — se algo aqui divergir do que o app faz, o erro é nosso e queremos saber.
      </p>

      <h2>Quem é o responsável</h2>
      <p>
        <strong>KZ3 Consultoria em Tecnologia Ltda</strong>, CNPJ 50.812.328/0001-80, São Roque/SP,
        Brasil. Contato para privacidade, correção e exclusão de dados:{' '}
        <a href="mailto:fabio.gasparr@gmail.com" className="text-primary underline underline-offset-4">
          fabio.gasparr@gmail.com
        </a>
        .
      </p>

      <h2>Dados que coletamos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> e-mail e nome de exibição, informados por você no cadastro.
        </li>
        <li>
          <strong>Conteúdo que você cria:</strong> tarefas, subtarefas, projetos, prazos, anotações,
          lembretes, times e organizações, além de imagens que você anexar a uma tarefa.
        </li>
        <li>
          <strong>Uso do aplicativo:</strong> métricas de produtividade e conquistas geradas a partir
          das suas próprias tarefas (quantas concluídas, em que quadrante, em que período).
        </li>
        <li>
          <strong>Integrações que você ligar:</strong> as credenciais e identificadores necessários
          para a conexão funcionar — descritos nas duas seções seguintes.
        </li>
      </ul>
      <p>
        Não usamos cookies de publicidade nem rastreadores de terceiros. O armazenamento local do seu
        navegador guarda apenas a sua sessão e preferências como idioma e tema.
      </p>

      <h2>Dados da sua conta Google</h2>
      <p>
        A conexão com o Google Calendar é <strong>opcional</strong> e só acontece quando você clica em
        conectar e autoriza na tela do próprio Google. Pedimos os escopos mínimos para a função
        existir:
      </p>
      <ul>
        <li>
          <code>calendar.events</code> — criar, atualizar e remover os eventos que correspondem às
          suas tarefas do EisenFlow;
        </li>
        <li>
          <code>calendar.calendarlist.readonly</code> — listar suas agendas, para você escolher em
          qual as tarefas devem aparecer;
        </li>
        <li>
          <code>openid</code> e <code>email</code> — identificar qual conta Google foi conectada.
        </li>
      </ul>
      <p>
        Guardamos os tokens de acesso e de atualização <strong>cifrados</strong> no nosso banco de
        dados, e um registro de auditoria dos momentos em que a conexão foi usada. Não guardamos
        cópia do conteúdo das suas agendas.
      </p>
      <p>
        <strong>Uso limitado (Limited Use).</strong> O uso das informações recebidas das APIs do
        Google pelo EisenFlow adere à{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-4"
        >
          Política de Dados do Usuário dos Serviços de API do Google
        </a>
        , inclusive aos requisitos de Uso Limitado. Na prática, isso significa que os dados da sua
        conta Google:
      </p>
      <ul>
        <li>são usados apenas para manter a sincronia entre tarefas e eventos, a seu pedido;</li>
        <li>não são vendidos, alugados nem usados para publicidade ou perfilamento;</li>
        <li>
          não são transferidos a modelos de inteligência artificial, nem para treiná-los nem para
          gerar respostas;
        </li>
        <li>
          não são acessados por pessoas, exceto quando você pedir suporte e autorizar, quando for
          necessário por segurança, ou quando a lei exigir.
        </li>
      </ul>
      <p>
        Você pode desconectar a qualquer momento em <strong>Configurações → Google Calendar</strong>,
        e revogar o acesso diretamente em{' '}
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-4"
        >
          myaccount.google.com/permissions
        </a>
        . Ao desconectar, apagamos os tokens guardados.
      </p>

      <h2>WhatsApp</h2>
      <p>
        Também opcional. Ao parear pelo QR code, guardamos o identificador e a credencial da sua
        instância e o número conectado, para enviar os lembretes que você configurou e interpretar as
        mensagens que você mandar ao número do EisenFlow. As mensagens trafegam por um servidor
        Evolution GO sob nossa administração. Você desconecta quando quiser, e a credencial é
        descartada.
      </p>

      <h2>Inteligência artificial</h2>
      <p>
        Alguns recursos — classificação de urgência e importância, sugestão de subtarefas, chat de
        tarefas e leitura de imagens anexadas — enviam o <strong>texto da tarefa</strong> (e a imagem,
        quando for esse o recurso) a um modelo de linguagem, por meio de um gateway sob nossa
        administração. Esses recursos são acionados por você. Nenhum dado vindo da sua conta Google é
        enviado nesse caminho.
      </p>

      <h2>Com quem compartilhamos</h2>
      <p>
        Não vendemos dados. Compartilhamos apenas o necessário com os provedores que fazem o serviço
        funcionar: a infraestrutura que hospeda o aplicativo e o banco de dados, o serviço de envio de
        e-mails transacionais (confirmação de cadastro e recuperação de senha), o servidor de WhatsApp
        e os provedores de modelos de IA. Dentro de um time ou organização, o conteúdo que você
        compartilhar fica visível para os demais membros daquele grupo — só ele.
      </p>

      <h2>Por quanto tempo guardamos</h2>
      <p>
        Enquanto a sua conta existir. Ao pedir a exclusão, apagamos sua conta e o conteúdo associado,
        salvo o que a lei nos obrigue a reter. Backups em rotação podem manter cópias por até 30 dias
        após a exclusão.
      </p>

      <h2>Seus direitos (LGPD)</h2>
      <p>
        A Lei nº 13.709/2018 garante a você confirmar a existência de tratamento, acessar, corrigir,
        anonimizar, portar e excluir seus dados, além de revogar consentimento. Escreva para o
        contato acima; respondemos em até 15 dias.
      </p>

      <h2>Segurança</h2>
      <p>
        O tráfego é cifrado em trânsito (HTTPS), os tokens das integrações são cifrados em repouso e o
        acesso aos dados é isolado por usuário e por organização no banco de dados. Nenhum sistema é
        infalível: se ocorrer um incidente que traga risco relevante a você, comunicaremos você e a
        ANPD.
      </p>

      <h2>Menores de idade</h2>
      <p>O EisenFlow não é destinado a menores de 16 anos.</p>

      <h2>Mudanças nesta política</h2>
      <p>
        Se mudarmos algo relevante, atualizamos a data no topo e avisamos no aplicativo antes de a
        mudança valer. Ao continuar usando, você concorda com a versão vigente. Veja também os{' '}
        <Link to="/termos" className="text-primary underline underline-offset-4">
          Termos de Serviço
        </Link>
        .
      </p>
    </PaginaPublica>
  );
}
