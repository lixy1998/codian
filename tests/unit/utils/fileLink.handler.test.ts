import { CODIAN_HOVER_LINK_SOURCE, registerFileLinkHandler } from '@/utils/fileLink';

function createLink(dataset: Record<string, string>, href: string | null = null) {
  const link: any = {
    dataset,
    getAttribute: jest.fn().mockReturnValue(href),
    closest: jest.fn(),
    contains: jest.fn().mockReturnValue(false),
  };
  link.closest.mockReturnValue(link);
  return link;
}

function createComponent(eventName: string, payload: any) {
  return {
    registerDomEvent: (_el: HTMLElement, name: string, cb: (event: any) => void) => {
      if (name === eventName) cb(payload);
    },
  };
}

describe('registerFileLinkHandler', () => {
  it('opens data-href target when present', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    const link = createLink({ href: 'note#section' }, 'note');
    const event = {
      target: link,
      preventDefault: jest.fn(),
    };

    registerFileLinkHandler(
      app as any,
      {} as HTMLElement,
      createComponent('click', event) as any
    );

    expect(event.preventDefault).toHaveBeenCalled();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#section', '', 'tab');
  });

  it('falls back to href when data-href is missing', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    const link = createLink({}, 'note^block');
    const event = {
      target: link,
      preventDefault: jest.fn(),
    };

    registerFileLinkHandler(
      app as any,
      {} as HTMLElement,
      createComponent('click', event) as any
    );

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note^block', '', 'tab');
  });

  it('forwards link hover to the page preview plugin', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
        trigger: jest.fn(),
      },
    };

    const link = createLink({ href: 'note#section' });
    const container = {} as HTMLElement;
    const event = {
      target: link,
      relatedTarget: null,
    };

    registerFileLinkHandler(
      app as any,
      container,
      createComponent('mouseover', event) as any
    );

    expect(app.workspace.trigger).toHaveBeenCalledWith('hover-link', {
      event,
      source: CODIAN_HOVER_LINK_SOURCE,
      hoverParent: container,
      targetEl: link,
      linktext: 'note#section',
    });
    expect((container as any).hoverPopover).toBeNull();
  });

  it('ignores hover events bubbling inside the same link', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
        trigger: jest.fn(),
      },
    };

    const link = createLink({ href: 'note' });
    link.contains.mockReturnValue(true);
    const event = {
      target: link,
      relatedTarget: {},
    };

    registerFileLinkHandler(
      app as any,
      {} as HTMLElement,
      createComponent('mouseover', event) as any
    );

    expect(app.workspace.trigger).not.toHaveBeenCalled();
  });

  it('skips hover when the link has no target', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
        trigger: jest.fn(),
      },
    };

    const link = createLink({}, null);
    const event = {
      target: link,
      relatedTarget: null,
    };

    registerFileLinkHandler(
      app as any,
      {} as HTMLElement,
      createComponent('mouseover', event) as any
    );

    expect(app.workspace.trigger).not.toHaveBeenCalled();
  });
});
